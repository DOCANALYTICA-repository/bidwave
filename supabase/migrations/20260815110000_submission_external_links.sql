-- ---------------------------------------------------------------------------
-- Link submissions: a submission entry may be a shared URL instead of an
-- uploaded object.
--
-- Storage on this project caps every object at 50MB (a project-wide limit
-- that overrides the bucket's own 250MB — see migration 20260815100000),
-- so a round whose deliverable is a video cannot always be satisfied by an
-- upload. Teams over the cap share the file from Google Drive instead and
-- submit the link; the row is otherwise an ordinary submission_files entry,
-- so supersede-on-replace, RLS, scoring and exports all keep working
-- unchanged.
--
-- `storage_path` becomes nullable and gains a partner column rather than a
-- separate table: "the current submission" must stay one ordered set that
-- whole-set replacement (SUB-02/03) supersedes atomically, and splitting it
-- across two tables would make that two statements to keep in step.
-- ---------------------------------------------------------------------------

alter table public.submission_files
  alter column storage_path drop not null,
  alter column mime_type drop not null,
  add column if not exists external_url text;

-- Exactly one of the two: a row is either a stored object or a link, never
-- both and never neither.
alter table public.submission_files
  add constraint submission_files_object_xor_link
  check (num_nonnulls(storage_path, external_url) = 1);

comment on column public.submission_files.external_url is
  'Set instead of storage_path when the team submitted a shared link '
  '(Google Drive et al.) because the file exceeds the Storage upload cap. '
  'mime_type is null for these rows.';

-- ---------------------------------------------------------------------------
-- submit_round_files(): same contract, now accepting link entries.
--
-- Each element of p_files carries either `storage_path` + `mime_type` or
-- `external_url`. The check constraint above is the guard — a malformed
-- element raises rather than silently recording half a row.
-- ---------------------------------------------------------------------------

create or replace function public.submit_round_files(
  p_team_id uuid,
  p_round_id uuid,
  p_files jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_submission_id uuid;
  v_file jsonb;
begin
  select * into v_round from public.rounds where id = p_round_id;
  if v_round.id is null then
    raise exception '[not_found] Round not found.';
  end if;

  if not public.can_team_submit(p_round_id, p_team_id) then
    raise exception '[submission_not_allowed] This round is not open for submission by your team.';
  end if;

  if p_files is null or jsonb_array_length(p_files) < 1 then
    raise exception '[no_files] At least one file is required.';
  end if;

  insert into public.submissions (round_id, team_id, status, submitted_at)
  values (p_round_id, p_team_id, 'submitted', now())
  on conflict (round_id, team_id)
    do update set status = 'submitted', submitted_at = now()
  returning id into v_submission_id;

  -- Whole-set replacement (adopted default): supersede everything currently
  -- live before inserting the new set, in the same transaction.
  update public.submission_files
  set superseded_at = now()
  where submission_id = v_submission_id and superseded_at is null;

  for v_file in select * from jsonb_array_elements(p_files) loop
    insert into public.submission_files (
      submission_id, storage_path, file_name, mime_type, external_url
    )
    values (
      v_submission_id,
      nullif(v_file ->> 'storage_path', ''),
      v_file ->> 'file_name',
      nullif(v_file ->> 'mime_type', ''),
      nullif(v_file ->> 'external_url', '')
    );
  end loop;

  perform public.log_activity(
    v_round.event_edition_id, p_team_id, 'team', 'round_submitted',
    jsonb_build_object('round_id', p_round_id, 'file_count', jsonb_array_length(p_files))
  );

  return v_submission_id;
end;
$$;

comment on function public.submit_round_files(uuid, uuid, jsonb) is
  'AT-RND-02/03, SUB-02/03/05: called from a Server Action after files are '
  'already uploaded to the "submissions" storage bucket via the admin '
  'client — same order as register_team(). Elements of p_files carry '
  'either storage_path + mime_type (uploaded object) or external_url '
  '(shared link, for files above the Storage upload cap).';

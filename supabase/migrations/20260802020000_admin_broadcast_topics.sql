-- Migration — extends live_broadcast/broadcast_live() coverage (principle
-- #5, defined once in 20260730080000_auction.sql) from the 3 admin domains
-- that already had it (auction console, analytics-requests, activity log)
-- to the remaining admin domains: teams, round lifecycle, leaderboard,
-- stages, announcements, and simulation. This is the DB-side prerequisite
-- for wiring every admin route to useLiveBroadcast (src/lib/realtime/
-- use-live-broadcast.ts) in the Phase 5 client-data rewrite — today those
-- routes only refresh on a manual navigation or the admin's own action.
--
-- "final results" is not a separate topic: it's the same
-- leaderboard_snapshots table and admin_publish_leaderboard() RPC as
-- /admin/leaderboard (kind = 'final_top_10' vs 'top_15'), so the
-- 'leaderboard' topic covers both admin pages.
--
-- Scoped to the mutation each domain's admin list view actually needs to
-- react to — round-material/rubric-criterion/individual-score edits don't
-- get their own topic here; the round list itself (admin_upsert_round,
-- admin_set_round_lifecycle) and the score-publish action already give
-- /admin/rounds a live signal without broadcasting every granular edit.
--
-- Every function below is `create or replace` with the exact same
-- signature it already has (confirmed via the migration history — only
-- admin_set_round_lifecycle and admin_set_simulation_lifecycle were ever
-- redefined after their original migration, so the versions reproduced
-- here are their current 4-arg forms from
-- 20260802000000_admin_reversal_and_simulation_visibility.sql) — existing
-- grants stay attached to that signature and don't need to be reissued.
-- Three functions (admin_publish_scores_for_round, admin_add_stage_adjustment,
-- admin_hide_leaderboard) move from `language sql` to `language plpgsql`
-- purely so `perform` has somewhere unambiguous to go — same logic, same
-- errors, just a normal declare/begin/end body instead of a bare statement
-- list (avoids relying on unreferenced-CTE-execution semantics for a
-- volatile side-effecting call).

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------

create or replace function public.register_team(
  p_auth_user_id uuid,
  p_event_edition_id uuid,
  p_team_name text,
  p_campus text,
  p_members jsonb,
  p_invoice_storage_path text,
  p_invoice_file_name text,
  p_invoice_mime_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_captain_email extensions.citext;
  v_constraint_name text;
begin
  if not public.is_registration_open(p_event_edition_id) then
    raise exception '[registration_closed] Registration is not currently open.';
  end if;

  if jsonb_array_length(p_members) < 3 or jsonb_array_length(p_members) > 4 then
    raise exception '[invalid_member_count] Teams must have 3 or 4 members.';
  end if;

  if (
    select count(*) from jsonb_array_elements(p_members) m
    where (m ->> 'is_captain')::boolean
  ) <> 1 then
    raise exception '[missing_captain] Exactly one member must be marked as captain.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_members) m
    where (m ->> 'christ_email') !~* '\.christuniversity\.in$'
  ) then
    raise exception '[invalid_email_domain] All member emails must end in .christuniversity.in';
  end if;

  select m ->> 'christ_email' into v_captain_email
  from jsonb_array_elements(p_members) m
  where (m ->> 'is_captain')::boolean
  limit 1;

  begin
    insert into public.teams (id, event_edition_id, name, campus, captain_email)
    values (p_auth_user_id, p_event_edition_id, p_team_name, p_campus, v_captain_email);
  exception when unique_violation then
    raise exception '[duplicate_team_name] Team name "%" is already registered.', p_team_name;
  end;

  begin
    insert into public.team_members
      (team_id, event_edition_id, full_name, class, register_number, phone, christ_email, is_captain)
    select
      p_auth_user_id,
      p_event_edition_id,
      m ->> 'full_name',
      m ->> 'class',
      m ->> 'register_number',
      m ->> 'phone',
      m ->> 'christ_email',
      (m ->> 'is_captain')::boolean
    from jsonb_array_elements(p_members) m;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'team_members_register_number_unique' then
      raise exception '[duplicate_register_number] One of the register numbers is already registered for this edition.';
    elsif v_constraint_name = 'team_members_christ_email_unique' then
      raise exception '[duplicate_email] One of the member emails is already registered for this edition.';
    else
      raise exception '[duplicate_member_field] A member field is already registered.';
    end if;
  end;

  insert into public.invoices (team_id, storage_path, file_name, mime_type)
  values (p_auth_user_id, p_invoice_storage_path, p_invoice_file_name, p_invoice_mime_type);

  perform public.log_activity(
    p_event_edition_id, p_auth_user_id, 'team', 'registration_submitted',
    jsonb_build_object('team_name', p_team_name)
  );

  perform public.broadcast_live(
    p_event_edition_id, 'teams', 'team_registered', jsonb_build_object('team_id', p_auth_user_id)
  );

  return p_auth_user_id;
end;
$$;

create or replace function public.admin_update_team(
  p_team_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_campus text,
  p_members jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual_updated_at timestamptz;
  v_event_edition_id uuid;
  v_captain_email extensions.citext;
  v_constraint_name text;
begin
  select updated_at, event_edition_id into v_actual_updated_at, v_event_edition_id
  from public.teams where id = p_team_id
  for update; -- lock the row for the duration of this edit

  if v_actual_updated_at is null then
    raise exception '[not_found] Team not found.';
  end if;

  if v_actual_updated_at <> p_expected_updated_at then
    raise exception '[stale_edit] This team was edited by someone else — refresh and try again.';
  end if;

  if jsonb_array_length(p_members) < 3 or jsonb_array_length(p_members) > 4 then
    raise exception '[invalid_member_count] Teams must have 3 or 4 members.';
  end if;

  if (
    select count(*) from jsonb_array_elements(p_members) m
    where (m ->> 'is_captain')::boolean
  ) <> 1 then
    raise exception '[missing_captain] Exactly one member must be marked as captain.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_members) m
    where (m ->> 'christ_email') !~* '\.christuniversity\.in$'
  ) then
    raise exception '[invalid_email_domain] All member emails must end in .christuniversity.in';
  end if;

  select m ->> 'christ_email' into v_captain_email
  from jsonb_array_elements(p_members) m
  where (m ->> 'is_captain')::boolean
  limit 1;

  begin
    update public.teams
    set name = p_name, campus = p_campus, captain_email = v_captain_email
    where id = p_team_id;
  exception when unique_violation then
    raise exception '[duplicate_team_name] Team name "%" is already registered.', p_name;
  end;

  delete from public.team_members where team_id = p_team_id;

  begin
    insert into public.team_members
      (team_id, event_edition_id, full_name, class, register_number, phone, christ_email, is_captain)
    select
      p_team_id,
      v_event_edition_id,
      m ->> 'full_name',
      m ->> 'class',
      m ->> 'register_number',
      m ->> 'phone',
      m ->> 'christ_email',
      (m ->> 'is_captain')::boolean
    from jsonb_array_elements(p_members) m;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'team_members_register_number_unique' then
      raise exception '[duplicate_register_number] One of the register numbers is already registered for this edition.';
    elsif v_constraint_name = 'team_members_christ_email_unique' then
      raise exception '[duplicate_email] One of the member emails is already registered for this edition.';
    else
      raise exception '[duplicate_member_field] A member field is already registered.';
    end if;
  end;

  perform public.log_activity(
    v_event_edition_id, p_team_id, 'admin', 'team_edited_by_admin', '{}'::jsonb
  );

  perform public.broadcast_live(
    v_event_edition_id, 'teams', 'team_updated', jsonb_build_object('team_id', p_team_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- rounds
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_round(
  p_round_id uuid,
  p_expected_updated_at timestamptz,
  p_event_edition_id uuid,
  p_kind text,
  p_sequence int,
  p_slug text,
  p_title text,
  p_brief text,
  p_instructions text,
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_requires_qualification_from_stage uuid,
  p_rubric_total_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round_id uuid;
  v_actual_updated_at timestamptz;
begin
  if p_kind not in ('quiz', 'submission', 'offline_info', 'simulation', 'auction', 'conference') then
    raise exception '[invalid_kind] Unknown round kind.';
  end if;

  if p_round_id is not null then
    select updated_at into v_actual_updated_at from public.rounds where id = p_round_id;
    if v_actual_updated_at is null then
      raise exception '[not_found] Round not found.';
    end if;
    if p_expected_updated_at is not null and v_actual_updated_at <> p_expected_updated_at then
      raise exception '[stale_edit] This round was edited by someone else — refresh and try again.';
    end if;

    begin
      update public.rounds set
        kind = p_kind,
        sequence = p_sequence,
        slug = p_slug,
        title = p_title,
        brief = p_brief,
        instructions = p_instructions,
        opens_at = p_opens_at,
        closes_at = p_closes_at,
        requires_qualification_from_stage = p_requires_qualification_from_stage,
        rubric_total_mode = p_rubric_total_mode
      where id = p_round_id;
    exception when unique_violation then
      raise exception '[duplicate_round_slug] A round with this slug or sequence already exists.';
    end;

    v_round_id := p_round_id;
  else
    begin
      insert into public.rounds (
        event_edition_id, kind, sequence, slug, title, brief, instructions,
        opens_at, closes_at, requires_qualification_from_stage, rubric_total_mode
      ) values (
        p_event_edition_id, p_kind, p_sequence, p_slug, p_title, p_brief, p_instructions,
        p_opens_at, p_closes_at, p_requires_qualification_from_stage, p_rubric_total_mode
      )
      returning id into v_round_id;
    exception when unique_violation then
      raise exception '[duplicate_round_slug] A round with this slug or sequence already exists.';
    end;
  end if;

  perform public.broadcast_live(
    p_event_edition_id, 'rounds', 'round_saved', jsonb_build_object('round_id', v_round_id)
  );

  return v_round_id;
end;
$$;

drop function if exists public.admin_set_round_lifecycle(uuid, text);

create or replace function public.admin_set_round_lifecycle(
  p_round_id uuid,
  p_action text,
  p_admin_id uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if v_round.id is null then
    raise exception '[not_found] Round not found.';
  end if;

  if p_action = 'open_now' then
    if v_round.closed_at is not null then
      raise exception '[round_already_closed] A closed round cannot be reopened.';
    end if;
    update public.rounds set opened_early_at = now() where id = p_round_id;

  elsif p_action = 'close_now' then
    update public.rounds set closed_at = now() where id = p_round_id and closed_at is null;

  elsif p_action = 'start_scoring' then
    if v_round.closed_at is null and (v_round.closes_at is null or now() < v_round.closes_at) then
      raise exception '[round_not_closed] Scoring can only start once the round is closed.';
    end if;
    update public.rounds set
      scoring_started_at = now(),
      closed_at = coalesce(closed_at, now())
    where id = p_round_id and scoring_started_at is null;

  elsif p_action = 'mark_scored' then
    update public.rounds set scored_at = now() where id = p_round_id and scored_at is null;

  elsif p_action = 'release_publicly' then
    if v_round.closed_at is null or v_round.scored_at is null then
      raise exception '[round_not_scored] A round can only be released publicly once closed and scored.';
    end if;
    update public.rounds set public_released_at = now() where id = p_round_id and public_released_at is null;

  elsif p_action = 'unrelease' then
    update public.rounds set public_released_at = null where id = p_round_id;

  elsif p_action = 'archive' then
    update public.rounds set archived_at = now() where id = p_round_id and archived_at is null;

  elsif p_action = 'reopen' then
    if v_round.closed_at is null then
      raise exception '[round_not_closed] This round is not closed.';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception '[reason_required] A reason is required to reopen a round.';
    end if;
    perform public.assert_admin(p_admin_id);
    perform set_config('bidwave.allow_reopen', 'true', true);
    update public.rounds set
      closed_at = null,
      scoring_started_at = null,
      scored_at = null,
      public_released_at = null
    where id = p_round_id;
    perform public.log_activity(
      v_round.event_edition_id, null, 'admin', 'round_reopened',
      jsonb_build_object('round_id', p_round_id, 'admin_id', p_admin_id, 'reason', p_reason)
    );

  else
    raise exception '[invalid_action] Unknown round lifecycle action.';
  end if;

  perform public.broadcast_live(
    v_round.event_edition_id, 'rounds', 'lifecycle_' || p_action, jsonb_build_object('round_id', p_round_id)
  );
end;
$$;

revoke all on function public.admin_set_round_lifecycle(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_round_lifecycle(uuid, text, uuid, text) to service_role;

create or replace function public.admin_publish_scores_for_round(p_round_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_edition_id uuid;
  v_count int;
begin
  update public.scores set published = true, updated_at = now()
  where round_id = p_round_id and published = false;

  select event_edition_id into v_event_edition_id from public.rounds where id = p_round_id;
  perform public.broadcast_live(
    v_event_edition_id, 'rounds', 'scores_published', jsonb_build_object('round_id', p_round_id)
  );

  select count(*)::int into v_count from public.scores where round_id = p_round_id and published;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- leaderboard (also covers /admin/final-results — same table/RPC)
-- ---------------------------------------------------------------------------

create or replace function public.admin_publish_leaderboard(
  p_event_edition_id uuid,
  p_kind text,
  p_entries jsonb,
  p_entry_limit int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot_id uuid;
  v_entry jsonb;
  v_rank int := 0;
begin
  if p_kind not in ('top_15', 'final_top_10') then
    raise exception '[invalid_kind] Unknown leaderboard kind.';
  end if;

  update public.leaderboard_snapshots
  set hidden_at = now()
  where event_edition_id = p_event_edition_id and kind = p_kind and hidden_at is null;

  insert into public.leaderboard_snapshots (event_edition_id, kind, entry_limit, published_by)
  values (p_event_edition_id, p_kind, p_entry_limit, auth.uid())
  returning id into v_snapshot_id;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_rank := v_rank + 1;
    insert into public.leaderboard_snapshot_entries (snapshot_id, rank, team_name, score)
    values (
      v_snapshot_id,
      coalesce((v_entry ->> 'rank')::int, v_rank),
      v_entry ->> 'team_name',
      (v_entry ->> 'score')::numeric
    );
  end loop;

  perform public.broadcast_live(
    p_event_edition_id, 'leaderboard', 'published', jsonb_build_object('snapshot_id', v_snapshot_id, 'kind', p_kind)
  );

  return v_snapshot_id;
end;
$$;

create or replace function public.admin_hide_leaderboard(p_snapshot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_edition_id uuid;
begin
  update public.leaderboard_snapshots set hidden_at = now() where id = p_snapshot_id and hidden_at is null;

  select event_edition_id into v_event_edition_id from public.leaderboard_snapshots where id = p_snapshot_id;
  perform public.broadcast_live(
    v_event_edition_id, 'leaderboard', 'hidden', jsonb_build_object('snapshot_id', p_snapshot_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- stages
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_stage_rounds(p_stage_id uuid, p_round_weights jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rw jsonb;
  v_event_edition_id uuid;
begin
  delete from public.stage_rounds where stage_id = p_stage_id;
  for v_rw in select * from jsonb_array_elements(p_round_weights) loop
    insert into public.stage_rounds (stage_id, round_id, weight)
    values (p_stage_id, (v_rw ->> 'round_id')::uuid, coalesce((v_rw ->> 'weight')::numeric, 1));
  end loop;

  select event_edition_id into v_event_edition_id from public.stages where id = p_stage_id;
  perform public.broadcast_live(
    v_event_edition_id, 'stages', 'stage_rounds_set', jsonb_build_object('stage_id', p_stage_id)
  );
end;
$$;

create or replace function public.admin_add_stage_adjustment(
  p_stage_id uuid,
  p_team_id uuid,
  p_amount numeric,
  p_reason text,
  p_source_ref text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_event_edition_id uuid;
begin
  insert into public.stage_adjustments (stage_id, team_id, amount, reason, source_ref, created_by)
  values (p_stage_id, p_team_id, p_amount, p_reason, p_source_ref, auth.uid())
  returning id into v_id;

  select event_edition_id into v_event_edition_id from public.stages where id = p_stage_id;
  perform public.broadcast_live(
    v_event_edition_id, 'stages', 'adjustment_added', jsonb_build_object('stage_id', p_stage_id, 'team_id', p_team_id)
  );

  return v_id;
end;
$$;

create or replace function public.admin_confirm_qualifications(p_stage_id uuid, p_decisions jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_standing record;
  v_decision text;
  v_snapshot jsonb;
  v_event_edition_id uuid;
begin
  for v_standing in select * from public.stage_standings(p_stage_id) loop
    select d ->> 'decision' into v_decision
    from jsonb_array_elements(p_decisions) d
    where (d ->> 'team_id')::uuid = v_standing.team_id
    limit 1;

    if v_decision is null then
      continue;
    end if;

    if v_decision not in ('qualified', 'eliminated', 'pending') then
      raise exception '[invalid_decision] Decision must be qualified, eliminated or pending.';
    end if;

    v_snapshot := jsonb_build_object('aggregate', v_standing.aggregate, 'rank', v_standing.rank);

    insert into public.qualifications (stage_id, team_id, rank, aggregate_snapshot, decision, decided_at, decided_by)
    values (p_stage_id, v_standing.team_id, v_standing.rank, v_snapshot, v_decision, now(), auth.uid())
    on conflict (stage_id, team_id)
      do update set rank = excluded.rank, aggregate_snapshot = excluded.aggregate_snapshot,
                    decision = excluded.decision, decided_at = now(), decided_by = auth.uid();
  end loop;

  select event_edition_id into v_event_edition_id from public.stages where id = p_stage_id;

  perform public.log_activity(
    v_event_edition_id, null, 'admin', 'qualifications_confirmed',
    jsonb_build_object('stage_id', p_stage_id, 'decisions', p_decisions)
  );

  perform public.broadcast_live(
    v_event_edition_id, 'stages', 'qualifications_confirmed', jsonb_build_object('stage_id', p_stage_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_announcement(
  p_announcement_id uuid,
  p_event_edition_id uuid,
  p_audience text,
  p_message text,
  p_visibility text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_audience not in ('all', 'team', 'public') then
    raise exception '[invalid_audience] Unknown announcement audience.';
  end if;
  if p_visibility not in ('draft', 'published') then
    raise exception '[invalid_visibility] Unknown announcement visibility.';
  end if;

  if p_announcement_id is not null then
    update public.announcements
    set audience = p_audience, message = p_message, visibility = p_visibility
    where id = p_announcement_id
    returning id into v_id;
    if v_id is null then
      raise exception '[not_found] Announcement not found.';
    end if;
  else
    insert into public.announcements (event_edition_id, audience, message, visibility, created_by)
    values (p_event_edition_id, p_audience, p_message, p_visibility, auth.uid())
    returning id into v_id;
  end if;

  perform public.broadcast_live(
    p_event_edition_id, 'announcements', 'announcement_saved', jsonb_build_object('announcement_id', v_id)
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- simulation
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_simulation_config(
  p_config_id uuid,
  p_expected_updated_at timestamptz,
  p_event_edition_id uuid,
  p_round_id uuid,
  p_parameters jsonb,
  p_scoring jsonb,
  p_answer_key jsonb,
  p_global_timer_seconds int,
  p_submit_cooldown_seconds int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config_id uuid;
  v_actual_updated_at timestamptz;
  v_defaults_params jsonb;
  v_defaults_eval jsonb;
  v_defaults_overall numeric;
  v_probe public.simulation_config;
begin
  select jsonb_build_object(
    'categorical', (
      select jsonb_object_agg(c ->> 'key', c ->> 'default')
      from jsonb_array_elements(p_parameters -> 'categorical') c
    ),
    'sliders', (
      select jsonb_object_agg(s ->> 'key', (s ->> 'default')::numeric)
      from jsonb_array_elements(p_parameters -> 'sliders') s
    )
  )
  into v_defaults_params;

  v_probe.scoring := p_scoring;
  v_probe.answer_key := p_answer_key;
  v_defaults_eval := public.simulation_evaluate(v_probe, v_defaults_params);
  v_defaults_overall := (v_defaults_eval ->> 'overall')::numeric;

  if v_defaults_overall <> 70 then
    raise exception '[calibration_failed] All-defaults must evaluate to exactly 70 (got %) — adjust overall_offset.', v_defaults_overall;
  end if;

  if p_config_id is not null then
    select updated_at into v_actual_updated_at from public.simulation_config where id = p_config_id;
    if v_actual_updated_at is null then
      raise exception '[not_found] Simulation config not found.';
    end if;
    if p_expected_updated_at is not null and v_actual_updated_at <> p_expected_updated_at then
      raise exception '[stale_edit] This config was edited by someone else — refresh and try again.';
    end if;

    update public.simulation_config set
      parameters = p_parameters, scoring = p_scoring, answer_key = p_answer_key,
      global_timer_seconds = p_global_timer_seconds, submit_cooldown_seconds = p_submit_cooldown_seconds,
      defaults_overall = v_defaults_overall, round_id = p_round_id
    where id = p_config_id;

    v_config_id := p_config_id;
  else
    insert into public.simulation_config (
      event_edition_id, round_id, parameters, scoring, answer_key,
      global_timer_seconds, submit_cooldown_seconds, defaults_overall
    ) values (
      p_event_edition_id, p_round_id, p_parameters, p_scoring, p_answer_key,
      p_global_timer_seconds, p_submit_cooldown_seconds, v_defaults_overall
    )
    returning id into v_config_id;
  end if;

  perform public.broadcast_live(
    p_event_edition_id, 'simulation', 'config_saved', jsonb_build_object('config_id', v_config_id)
  );

  return v_config_id;
end;
$$;

drop function if exists public.admin_set_simulation_lifecycle(uuid, text, uuid, text);

create or replace function public.admin_set_simulation_lifecycle(
  p_config_id uuid,
  p_action text,
  p_admin_id uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.simulation_config;
begin
  select * into v_config from public.simulation_config where id = p_config_id for update;
  if v_config.id is null then
    raise exception '[not_found] Simulation config not found.';
  end if;

  if p_action = 'start' then
    if v_config.stopped_at is not null then
      raise exception '[simulation_already_stopped] A stopped simulation cannot be restarted this way — use the restart action.';
    end if;
    update public.simulation_config set started_at = now() where id = p_config_id and started_at is null;

  elsif p_action = 'stop' then
    update public.simulation_config set stopped_at = now() where id = p_config_id and stopped_at is null;

  elsif p_action = 'reveal' then
    update public.simulation_config set visible_at = coalesce(visible_at, now()) where id = p_config_id;

  elsif p_action = 'hide' then
    update public.simulation_config set visible_at = null where id = p_config_id;

  elsif p_action = 'restart' then
    if v_config.stopped_at is null then
      raise exception '[simulation_not_stopped] Only a stopped simulation can be restarted.';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception '[reason_required] A reason is required to restart a stopped simulation.';
    end if;
    perform public.assert_admin(p_admin_id);
    update public.simulation_config set started_at = now(), stopped_at = null where id = p_config_id;
    perform public.log_activity(
      v_config.event_edition_id, null, 'admin', 'simulation_restarted',
      jsonb_build_object('config_id', p_config_id, 'admin_id', p_admin_id, 'reason', p_reason)
    );

  else
    raise exception '[invalid_action] Unknown simulation lifecycle action.';
  end if;

  perform public.broadcast_live(
    v_config.event_edition_id, 'simulation', 'lifecycle_' || p_action, jsonb_build_object('config_id', p_config_id)
  );
end;
$$;

revoke all on function public.admin_set_simulation_lifecycle(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_simulation_lifecycle(uuid, text, uuid, text) to service_role;

create or replace function public.admin_confirm_simulation_reward(
  p_config_id uuid,
  p_team_id uuid,
  p_attempt_id uuid,
  p_reward_kind text,
  p_amount numeric,
  p_target_round_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward_id uuid;
  v_event_edition_id uuid;
begin
  if p_reward_kind not in ('marks', 'purse') then
    raise exception '[invalid_reward_kind] Reward must be marks or purse.';
  end if;
  if p_reward_kind = 'marks' and p_target_round_id is null then
    raise exception '[invalid_reward] A marks reward requires a target round.';
  end if;

  insert into public.simulation_rewards
    (config_id, team_id, attempt_id, reward_kind, amount, target_round_id, created_by)
  values (p_config_id, p_team_id, p_attempt_id, p_reward_kind, p_amount, p_target_round_id, auth.uid())
  on conflict (config_id, team_id)
    do update set attempt_id = excluded.attempt_id, reward_kind = excluded.reward_kind,
                  amount = excluded.amount, target_round_id = excluded.target_round_id
  returning id into v_reward_id;

  if p_reward_kind = 'marks' then
    insert into public.scores (round_id, team_id, total, max_total, source, published, notes)
    values (p_target_round_id, p_team_id, p_amount, null, 'simulation', false, p_reason)
    on conflict (round_id, team_id)
      do update set total = excluded.total, notes = excluded.notes, updated_at = now()
      where public.scores.source = 'simulation';
  end if;

  select event_edition_id into v_event_edition_id from public.simulation_config where id = p_config_id;
  perform public.broadcast_live(
    v_event_edition_id, 'simulation', 'reward_confirmed', jsonb_build_object('config_id', p_config_id, 'team_id', p_team_id)
  );

  return v_reward_id;
end;
$$;

create or replace function public.reverse_simulation_reward(
  p_config_id uuid,
  p_team_id uuid,
  p_admin_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.simulation_rewards;
  v_event_edition_id uuid;
  v_ledger_id uuid;
begin
  perform public.assert_admin(p_admin_id);
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '[reason_required] A reason is required to reverse a reward.';
  end if;

  select * into v_reward from public.simulation_rewards
  where config_id = p_config_id and team_id = p_team_id for update;
  if v_reward.id is null then
    raise exception '[not_found] Reward not found.';
  end if;

  select event_edition_id into v_event_edition_id
  from public.simulation_config where id = v_reward.config_id;

  if v_reward.reward_kind = 'marks' then
    delete from public.scores
    where round_id = v_reward.target_round_id and team_id = v_reward.team_id and source = 'simulation';
  elsif v_reward.purse_applied_at is not null then
    insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, created_by, memo)
    values (v_event_edition_id, v_reward.team_id, 'reversal', -v_reward.amount, 'simulation_rewards', v_reward.id, p_admin_id, p_reason)
    returning id into v_ledger_id;
  end if;

  delete from public.simulation_rewards where id = v_reward.id;

  perform public.log_activity(
    v_event_edition_id, v_reward.team_id, 'admin', 'simulation_reward_reversed',
    jsonb_build_object('reward_id', v_reward.id, 'reason', p_reason, 'ledger_entry_id', v_ledger_id)
  );

  perform public.broadcast_live(
    v_event_edition_id, 'simulation', 'reward_reversed', jsonb_build_object('reward_id', v_reward.id, 'team_id', v_reward.team_id)
  );

  return jsonb_build_object('reward_id', v_reward.id, 'team_id', v_reward.team_id);
end;
$$;

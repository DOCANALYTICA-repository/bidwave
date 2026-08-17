-- ---------------------------------------------------------------------------
-- admin_save_score() accepted a score for any team_id that existed, with no
-- check on teams.status or on the round's own qualification gate
-- (rounds.requires_qualification_from_stage). Every other entry-point RPC
-- (record_sale, submit_simulation_attempt, request_analytics, quiz
-- submission) already calls public.team_meets_stage_requirement() to
-- enforce this (20260801093000_auction_integrity_and_qualification.sql) —
-- admin_save_score was the one gap, and per CLAUDE.md's "server is the only
-- authority" principle, the admin scoring RPC must enforce eligibility
-- itself rather than relying on the calling page having filtered its team
-- list correctly (defense in depth alongside the page.tsx query filter).
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_score(
  p_round_id uuid,
  p_team_id uuid,
  p_expected_updated_at timestamptz,
  p_total numeric,
  p_max_total numeric,
  p_criterion_values jsonb,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score_id uuid;
  v_actual_updated_at timestamptz;
  v_rubric_mode text;
  v_computed_total numeric;
  v_cv jsonb;
  v_team_status text;
begin
  select rubric_total_mode into v_rubric_mode from public.rounds where id = p_round_id;
  if v_rubric_mode is null then
    raise exception '[not_found] Round not found.';
  end if;

  select status into v_team_status from public.teams where id = p_team_id;
  if v_team_status is null then
    raise exception '[not_found] Team not found.';
  end if;
  if v_team_status <> 'active' then
    raise exception '[ineligible_team] This team is not active and cannot be scored.';
  end if;
  if not public.team_meets_stage_requirement(p_round_id, p_team_id) then
    raise exception '[ineligible_team] This team has not qualified for this round and cannot be scored.';
  end if;

  select id, updated_at into v_score_id, v_actual_updated_at
  from public.scores where round_id = p_round_id and team_id = p_team_id
  for update;

  if v_score_id is not null and p_expected_updated_at is not null
     and v_actual_updated_at <> p_expected_updated_at then
    raise exception '[stale_edit] This score was edited by someone else — refresh and try again.';
  end if;

  -- Recomputed from criteria when rubric values are supplied, so a stray
  -- client-sent total can never disagree with its own breakdown (SCR-06).
  if p_criterion_values is not null and jsonb_array_length(p_criterion_values) > 0 then
    select sum(
      (cv ->> 'value')::numeric *
      case when v_rubric_mode = 'weighted_percent'
        then rc.weight / nullif(rc.max_value, 0)
        else rc.weight
      end
    )
    into v_computed_total
    from jsonb_array_elements(p_criterion_values) cv
    join public.rubric_criteria rc on rc.id = (cv ->> 'criterion_id')::uuid
    where rc.round_id = p_round_id;
  else
    v_computed_total := p_total;
  end if;

  insert into public.scores (round_id, team_id, total, max_total, source, notes, entered_by)
  values (p_round_id, p_team_id, v_computed_total, p_max_total, 'manual', p_notes, auth.uid())
  on conflict (round_id, team_id)
    do update set total = v_computed_total, max_total = p_max_total, notes = p_notes,
                  entered_by = auth.uid(), updated_at = now()
  returning id into v_score_id;

  delete from public.score_criterion_values where score_id = v_score_id;

  if p_criterion_values is not null then
    for v_cv in select * from jsonb_array_elements(p_criterion_values) loop
      insert into public.score_criterion_values (score_id, criterion_id, value)
      values (v_score_id, (v_cv ->> 'criterion_id')::uuid, (v_cv ->> 'value')::numeric);
    end loop;
  end if;

  return v_score_id;
end;
$$;

comment on function public.admin_save_score(uuid, uuid, timestamptz, numeric, numeric, jsonb, text) is
  'SCR-05/06, ERR-07: same optimistic-concurrency shape as '
  'admin_update_team(). Publishing is a separate step below (LDB-04: '
  'entering scores never moves anything public). Enforces teams.status = '
  '''active'' and team_meets_stage_requirement() so a disqualified or '
  'not-yet-qualified team can never be scored, even if called directly '
  '(20260817110000).';

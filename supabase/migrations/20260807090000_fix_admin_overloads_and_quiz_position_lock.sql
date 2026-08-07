-- Migration — fix two regressions shipped by earlier migrations, plus a P0
-- authorization hole they caused.
--
-- ROOT CAUSE #1 (P0 security): 20260802020000_admin_broadcast_topics.sql
-- intended to `create or replace` five admin RPCs to add broadcast_live()
-- calls, but it dropped each function's trailing `p_admin_id uuid` param
-- (present since 20260801100000_admin_identity_threading.sql). Postgres
-- resolves overloaded functions by full signature, so `create or replace`
-- with a *different* signature does not replace anything — it silently
-- mints a brand-new function object. That new object is SECURITY DEFINER
-- with Postgres's default PUBLIC EXECUTE grant and contains no
-- assert_admin() call, so anon and authenticated could call it directly.
--
-- Two further consequences of the same mistake, fixed here too:
--   - The app still calls these RPCs with a `p_admin_id` argument (see
--     src/app/admin/{leaderboard,stages,announcements,simulation}/actions.ts),
--     so PostgREST resolves the OLD guarded overload — the one with no
--     broadcast_live() call. The live-broadcast feature for leaderboard
--     publishing, stage adjustments, qualifications, announcements and
--     simulation-reward confirmation has therefore never actually fired
--     since 2 Aug, despite the migration that was supposed to add it.
--   - The bogus overloads stamp `auth.uid()` into created_by/published_by/
--     decided_by. auth.uid() is null under the service-role connection
--     every admin server action uses (see 20260801100000's header) — this
--     is the exact null-attribution bug that migration had already fixed
--     once, reintroduced by the same mistake.
--
-- Fix: drop the five bogus short-signature overloads, then re-create the
-- long p_admin_id signatures (create or replace — ACLs survive because the
-- signature is unchanged) built from the 20260801100000 guarded bodies with
-- the broadcast_live() call merged in. Never build from the broadcast
-- version's body — admin_confirm_simulation_reward's short overload had
-- also silently dropped the '[attempt_not_a_win]' guard added by
-- 20260801100000 (audit high-priority #9); that guard is restored here.
--
-- admin_publish_scores_for_round / admin_hide_leaderboard /
-- admin_set_stage_rounds were NOT affected by this — they take no
-- p_admin_id, so 20260802020000's create-or-replace hit the same
-- signature and their revokes at 20260730040000:1489-1508 still apply.
-- Their revoke/grant is re-issued below anyway, as belt-and-braces.
--
-- ROOT CAUSE #2: 20260806120000_fix_quiz_question_position_race.sql (the
-- previous fix for a stale client-supplied `position`) used
-- `select max(position) + 1 ... for update`, which Postgres rejects at
-- runtime with "FOR UPDATE is not allowed with aggregate functions" —
-- every quiz-question insert has been failing since that migration shipped.
-- Fixed here with a per-round advisory transaction lock instead.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Drop the five bogus short-signature overloads.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_publish_leaderboard(uuid, text, jsonb, int);
drop function if exists public.admin_add_stage_adjustment(uuid, uuid, numeric, text, text);
drop function if exists public.admin_confirm_qualifications(uuid, jsonb);
drop function if exists public.admin_upsert_announcement(uuid, uuid, text, text, text);
drop function if exists public.admin_confirm_simulation_reward(uuid, uuid, uuid, text, numeric, uuid, text);

-- ---------------------------------------------------------------------------
-- 2. Re-create the five long (p_admin_id) signatures, guarded body + broadcast.
-- ---------------------------------------------------------------------------

create or replace function public.admin_add_stage_adjustment(
  p_stage_id uuid,
  p_team_id uuid,
  p_amount numeric,
  p_reason text,
  p_source_ref text,
  p_admin_id uuid
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
  perform public.assert_admin(p_admin_id);

  insert into public.stage_adjustments (stage_id, team_id, amount, reason, source_ref, created_by)
  values (p_stage_id, p_team_id, p_amount, p_reason, p_source_ref, p_admin_id)
  returning id into v_id;

  select event_edition_id into v_event_edition_id from public.stages where id = p_stage_id;
  perform public.broadcast_live(
    v_event_edition_id, 'stages', 'adjustment_added', jsonb_build_object('stage_id', p_stage_id, 'team_id', p_team_id)
  );

  return v_id;
end;
$$;

revoke all on function public.admin_add_stage_adjustment(uuid, uuid, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_add_stage_adjustment(uuid, uuid, numeric, text, text, uuid) to service_role;

create or replace function public.admin_confirm_qualifications(p_stage_id uuid, p_decisions jsonb, p_admin_id uuid)
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
  perform public.assert_admin(p_admin_id);

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
    values (p_stage_id, v_standing.team_id, v_standing.rank, v_snapshot, v_decision, now(), p_admin_id)
    on conflict (stage_id, team_id)
      do update set rank = excluded.rank, aggregate_snapshot = excluded.aggregate_snapshot,
                    decision = excluded.decision, decided_at = now(), decided_by = p_admin_id;
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

comment on function public.admin_confirm_qualifications(uuid, jsonb, uuid) is
  'AT-SCR-02: manual confirmation, never automatic from ranking. p_admin_id '
  'replaces auth.uid() for qualifications.decided_by (audit P0 #4). Broadcasts '
  'on the stages topic (20260807090000, restoring what 20260802020000''s '
  'unguarded overload silently orphaned).';

revoke all on function public.admin_confirm_qualifications(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.admin_confirm_qualifications(uuid, jsonb, uuid) to service_role;

create or replace function public.admin_publish_leaderboard(
  p_event_edition_id uuid,
  p_kind text,
  p_entries jsonb,
  p_entry_limit int,
  p_admin_id uuid
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
  perform public.assert_admin(p_admin_id);

  if p_kind not in ('top_15', 'final_top_10') then
    raise exception '[invalid_kind] Unknown leaderboard kind.';
  end if;

  update public.leaderboard_snapshots
  set hidden_at = now()
  where event_edition_id = p_event_edition_id and kind = p_kind and hidden_at is null;

  insert into public.leaderboard_snapshots (event_edition_id, kind, entry_limit, published_by)
  values (p_event_edition_id, p_kind, p_entry_limit, p_admin_id)
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

comment on function public.admin_publish_leaderboard(uuid, text, jsonb, int, uuid) is
  'p_admin_id replaces auth.uid() for leaderboard_snapshots.published_by '
  '(audit P0 #4). Broadcasts on the leaderboard topic (20260807090000, '
  'restoring what 20260802020000''s unguarded overload silently orphaned).';

revoke all on function public.admin_publish_leaderboard(uuid, text, jsonb, int, uuid) from public, anon, authenticated;
grant execute on function public.admin_publish_leaderboard(uuid, text, jsonb, int, uuid) to service_role;

create or replace function public.admin_upsert_announcement(
  p_announcement_id uuid,
  p_event_edition_id uuid,
  p_audience text,
  p_message text,
  p_visibility text,
  p_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.assert_admin(p_admin_id);

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
    values (p_event_edition_id, p_audience, p_message, p_visibility, p_admin_id)
    returning id into v_id;
  end if;

  perform public.broadcast_live(
    p_event_edition_id, 'announcements', 'announcement_saved', jsonb_build_object('announcement_id', v_id)
  );

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_announcement(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_upsert_announcement(uuid, uuid, text, text, text, uuid) to service_role;

create or replace function public.admin_confirm_simulation_reward(
  p_config_id uuid,
  p_team_id uuid,
  p_attempt_id uuid,
  p_reward_kind text,
  p_amount numeric,
  p_target_round_id uuid,
  p_reason text,
  p_admin_id uuid
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
  perform public.assert_admin(p_admin_id);

  if p_reward_kind not in ('marks', 'purse') then
    raise exception '[invalid_reward_kind] Reward must be marks or purse.';
  end if;
  if p_reward_kind = 'marks' and p_target_round_id is null then
    raise exception '[invalid_reward] A marks reward requires a target round.';
  end if;

  if p_attempt_id is not null and not exists (
    select 1 from public.simulation_attempts
    where id = p_attempt_id and team_id = p_team_id and config_id = p_config_id and success
  ) then
    raise exception '[attempt_not_a_win] The selected attempt was not a winning attempt for this team.';
  end if;

  insert into public.simulation_rewards
    (config_id, team_id, attempt_id, reward_kind, amount, target_round_id, created_by)
  values (p_config_id, p_team_id, p_attempt_id, p_reward_kind, p_amount, p_target_round_id, p_admin_id)
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

comment on function public.admin_confirm_simulation_reward(uuid, uuid, uuid, text, numeric, uuid, text, uuid) is
  'SIM-11: unique (config_id, team_id) on simulation_rewards means a team '
  'receives marks OR purse, never both. Requires a specified attempt to '
  'actually be a winning attempt for that team/config before a reward can '
  'be confirmed against it (audit high-priority #9) — 20260802020000''s '
  'unguarded overload had silently dropped this check; restored here. '
  'p_admin_id replaces auth.uid() for created_by (audit P0 #4). Broadcasts '
  'on the simulation topic.';

revoke all on function public.admin_confirm_simulation_reward(uuid, uuid, uuid, text, numeric, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_confirm_simulation_reward(uuid, uuid, uuid, text, numeric, uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Belt-and-braces: re-issue revoke/grant on the three functions that were
--    never actually exposed (same signature throughout, ACL never lost).
-- ---------------------------------------------------------------------------

revoke all on function public.admin_publish_scores_for_round(uuid) from public, anon, authenticated;
grant execute on function public.admin_publish_scores_for_round(uuid) to service_role;

revoke all on function public.admin_hide_leaderboard(uuid) from public, anon, authenticated;
grant execute on function public.admin_hide_leaderboard(uuid) to service_role;

revoke all on function public.admin_set_stage_rounds(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_set_stage_rounds(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Fix admin_upsert_quiz_question: FOR UPDATE + aggregate is illegal.
--    Identical signature to 20260806120000 — grants there still apply.
--    Body is otherwise unchanged from 20260806120000 (option validation,
--    edit path, quiz_options rewrite) — only the insert-path position calc
--    is replaced.
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_quiz_question(
  p_question_id uuid,
  p_round_id uuid,
  p_position int,
  p_prompt text,
  p_timer_seconds int,
  p_weight numeric,
  p_is_active boolean,
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_id uuid;
  v_event_edition_id uuid;
  v_opt jsonb;
  v_next_position int;
begin
  select event_edition_id into v_event_edition_id from public.rounds where id = p_round_id;
  if v_event_edition_id is null then
    raise exception '[not_found] Round not found.';
  end if;

  if p_options is null or jsonb_array_length(p_options) < 2 then
    raise exception '[invalid_options] At least two options are required.';
  end if;

  if (select count(*) from jsonb_array_elements(p_options) o where (o ->> 'is_correct')::boolean) <> 1 then
    raise exception '[invalid_options] Exactly one option must be marked correct.';
  end if;

  if p_question_id is not null then
    update public.quiz_questions
    set position = p_position, prompt = p_prompt, timer_seconds = p_timer_seconds,
        weight = p_weight, is_active = p_is_active
    where id = p_question_id
    returning id into v_question_id;
    if v_question_id is null then
      raise exception '[not_found] Question not found.';
    end if;
    delete from public.quiz_options where question_id = v_question_id;
  else
    -- FOR UPDATE is illegal alongside an aggregate — that is what
    -- 20260806120000 shipped, and it made every insert fail at runtime
    -- ("FOR UPDATE is not allowed with aggregate functions"). Row locks
    -- also cannot stop two concurrent inserts computing the same max+1
    -- anyway — there is no row to lock for the phantom row that hasn't
    -- been inserted yet. Serialize per-round with an advisory transaction
    -- lock instead: first (and only) use of pg_advisory_xact_lock in this
    -- schema. pg_catalog. qualification is required because this function
    -- runs with search_path = ''.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('public.quiz_questions.position:' || p_round_id::text, 0)
    );

    select coalesce(max(position) + 1, 0) into v_next_position
    from public.quiz_questions where round_id = p_round_id;

    insert into public.quiz_questions (round_id, event_edition_id, position, prompt, timer_seconds, weight, is_active)
    values (p_round_id, v_event_edition_id, v_next_position, p_prompt, p_timer_seconds, p_weight, p_is_active)
    returning id into v_question_id;
  end if;

  for v_opt in select * from jsonb_array_elements(p_options) loop
    insert into public.quiz_options (question_id, position, label, is_correct)
    values (v_question_id, (v_opt ->> 'position')::int, v_opt ->> 'label', (v_opt ->> 'is_correct')::boolean);
  end loop;

  return v_question_id;
end;
$$;

comment on function public.admin_upsert_quiz_question(uuid, uuid, int, text, int, numeric, boolean, jsonb) is
  'A new question''s position is computed authoritatively here (max+1) under '
  'a per-round advisory transaction lock (20260807090000) — never a '
  'client-supplied position, and never FOR UPDATE on an aggregate (illegal, '
  'and shipped broken in 20260806120000). Position for an edit of an '
  'existing question is still the caller''s explicit choice.';

-- ---------------------------------------------------------------------------
-- Migration: quiz re-attempt round + participant score-display fix
--
-- PART A — participant score display.
--   Round 1 ("The Stat Sprint") was scored out of 39.00 weighted points
--   across 35 questions (weights 0.5 x10, 1.0 x16, 2.0 x9). Teams were shown
--   only "32.00 / 39.00" while counting their own answers out of 35, so the
--   number on their dashboard was irreconcilable with what they remembered
--   doing. quiz_options is admin-only RLS by design (a team must never learn
--   which option was correct), so the correct-answer count cannot be derived
--   client-side — it has to be materialised here.
--   Adds quiz_attempts.correct_count / .question_count, populates them from
--   submit_quiz_attempt(), and backfills every already-submitted attempt.
--
-- PART B — the re-attempt round ("The Stat Sprint — Re-Attempt").
--   ~28 of 94 teams had their Round 1 attempt cut short by over-aggressive
--   exit detection (a brightness slider or notification shade dropping
--   fullscreen; a refresh firing the pagehide beacon). They re-sit the quiz
--   on a NEW round whose score supersedes the original in the r1_r2 stage
--   aggregate; the 46 clean finishers keep their scores untouched.
--
--   Four new rounds columns drive it, and ALL FOUR DEFAULT TO ROUND-1
--   BEHAVIOUR (is_invite_only=false, quiz_exit_policy='strict',
--   quiz_strike_limit=1, supersedes_round_id=null). Applying this migration
--   therefore changes nothing for any existing row — deliberate, because it
--   lands on a live database with 94 real teams while Round 1 is still open.
--
--   Every replaced RPC keeps its exact signature (the quiz RPCs return
--   jsonb, so new fields are additive; stage_standings keeps its OUT
--   columns), so no drop+recreate and no re-grants are needed and there is
--   no window where a hot function does not exist.
--
-- REVERT: purely additive. Drop the added columns and restore the prior
-- bodies of can_team_submit (20260801093000_auction_integrity_and_
-- qualification.sql), start_quiz_attempt / get_quiz_state /
-- submit_quiz_attempt (20260730050000_quiz_engine.sql) and stage_standings
-- (20260807090000_fix_admin_overloads_and_quiz_position_lock.sql:453).
-- Never drop round_eligible_teams data.
--
-- Applied with: node scripts/apply-migration.cjs <this file>
-- (Docker is broken on this machine — see CLAUDE.md. The applier wraps the
-- whole file in one transaction, so no CREATE INDEX CONCURRENTLY here.)
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- PART A — score-display columns + backfill
-- ===========================================================================

alter table public.quiz_attempts
  add column correct_count int,
  add column question_count int;

comment on column public.quiz_attempts.correct_count is
  'How many questions the team got right. Distinct from raw_score, which is '
  'the WEIGHTED point total — questions carry 0.5/1/2 point weights, so '
  '"29 of 35 correct" and "32.00 / 39.00 points" are both true of the same '
  'attempt. Materialised because quiz_options.is_correct is admin-only RLS '
  'and a team can never compute this for itself.';

comment on column public.quiz_attempts.question_count is
  'cardinality(question_order) at submit time, denormalised so the team-facing '
  'score line does not need the uuid[] itself.';

-- Backfill every attempt already submitted before this migration. Idempotent
-- (guarded on correct_count is null) and reads the same
-- quiz_answers -> quiz_options.is_correct path submit_quiz_attempt() used, so
-- the counts are consistent with the raw_score already stored.
update public.quiz_attempts a set
  question_count = cardinality(a.question_order),
  correct_count = (
    select count(*)
    from public.quiz_answers ans
    join public.quiz_options o on o.id = ans.option_id
    where ans.attempt_id = a.id and o.is_correct
  )
where a.status = 'submitted' and a.correct_count is null;

-- ===========================================================================
-- PART B.1 — rounds: supersede + invite-only + per-round quiz exit policy
-- ===========================================================================

alter table public.rounds
  add column supersedes_round_id uuid references public.rounds (id) on delete set null,
  add column is_invite_only boolean not null default false,
  add column quiz_exit_policy text not null default 'strict'
    check (quiz_exit_policy in ('strict', 'lenient')),
  add column quiz_strike_limit int not null default 1
    check (quiz_strike_limit between 1 and 5);

alter table public.rounds
  add constraint rounds_supersedes_not_self
    check (supersedes_round_id is distinct from id);

-- At most one superseding round per original: this is what lets
-- stage_standings resolve the rule with a single 1:1 lookup rather than
-- walking a chain of arbitrary depth.
create unique index rounds_supersedes_round_id_unique
  on public.rounds (supersedes_round_id)
  where supersedes_round_id is not null;

comment on column public.rounds.supersedes_round_id is
  'This round REPLACES the referenced round in any stage aggregate, for the '
  'teams that have a score row in this round. Both scores rows stay on '
  'record — only stage_standings() ignores the original. Set on the Round 1 '
  're-attempt so a re-sit counts instead of (never in addition to) the '
  'original Stat Sprint attempt.';

comment on column public.rounds.is_invite_only is
  'Only teams listed in round_eligible_teams may start/submit. Enforced in '
  'can_team_submit() and again in start_quiz_attempt(); the team dashboard '
  'filter is cosmetic on top of those.';

comment on column public.rounds.quiz_exit_policy is
  '"strict" reproduces the original Round 1 behaviour exactly: the first exit '
  'signal submits the attempt. "lenient" spends quiz_strike_limit strikes '
  'first, showing a blocking warning in between, and narrows the signals '
  'that count at all (see record_quiz_strike + the runner) — fullscreen is '
  'not monitored and a refresh resumes rather than submits.';

create or replace function public.rounds_no_supersede_chain()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.supersedes_round_id is not null and exists (
    select 1 from public.rounds r
    where r.id = new.supersedes_round_id
      and r.supersedes_round_id is not null
  ) then
    raise exception
      '[invalid_supersede] A round cannot supersede a round that already supersedes another.';
  end if;
  return new;
end;
$$;

create trigger rounds_no_supersede_chain
  before insert or update on public.rounds
  for each row execute function public.rounds_no_supersede_chain();

-- ===========================================================================
-- PART B.2 — the eligibility allowlist
-- ===========================================================================

create table public.round_eligible_teams (
  round_id uuid not null references public.rounds (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  reason text,
  added_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (round_id, team_id)
);

create index round_eligible_teams_team_idx on public.round_eligible_teams (team_id);

comment on table public.round_eligible_teams is
  'Admin-curated allowlist for is_invite_only rounds. Deliberately NOT '
  'derived from attempt outcomes: who gets a re-attempt is a human decision '
  'about who reported a genuine problem, not a query.';

alter table public.round_eligible_teams enable row level security;

-- The team must be able to read its OWN row: the dashboard filters
-- invite-only rounds through the RLS-bound client, not the admin client.
-- teams.id IS the auth.users id (20260729153617_teams_and_registration.sql).
create policy "round_eligible_teams_select_own_or_admin"
  on public.round_eligible_teams for select
  to authenticated
  using (team_id = (select auth.uid()) or public.is_admin());

create policy "round_eligible_teams_admin_write"
  on public.round_eligible_teams for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.team_is_round_eligible(p_round_id uuid, p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invite boolean;
begin
  if p_round_id is null then
    return true;
  end if;

  select is_invite_only into v_invite from public.rounds where id = p_round_id;

  -- A missing round is not an implicit yes.
  if v_invite is null then
    return false;
  end if;

  if not v_invite then
    return true;
  end if;

  return exists (
    select 1 from public.round_eligible_teams
    where round_id = p_round_id and team_id = p_team_id
  );
end;
$$;

revoke all on function public.team_is_round_eligible(uuid, uuid) from public, anon, authenticated;
grant execute on function public.team_is_round_eligible(uuid, uuid) to service_role;

-- ===========================================================================
-- PART B.3 — can_team_submit(): one added branch
-- Body copied verbatim from 20260801093000_auction_integrity_and_
-- qualification.sql, plus the eligibility check. Same signature, so its
-- existing grant to `authenticated` survives untouched.
-- ===========================================================================

create or replace function public.can_team_submit(p_round_id uuid, p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_team_status text;
begin
  if p_team_id <> (select auth.uid()) and not public.is_admin() then
    return false;
  end if;

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.id is null then
    return false;
  end if;

  select status into v_team_status from public.teams where id = p_team_id;
  if v_team_status is distinct from 'active' then
    return false;
  end if;

  if public.effective_round_status(v_round) <> 'open' then
    return false;
  end if;

  if not public.team_meets_stage_requirement(p_round_id, p_team_id) then
    return false;
  end if;

  -- 20260814050000: invite-only rounds (the Round 1 re-attempt).
  if not public.team_is_round_eligible(p_round_id, p_team_id) then
    return false;
  end if;

  return true;
end;
$$;

-- ===========================================================================
-- PART B.4 — start_quiz_attempt(): specific refusal for a non-invited team
-- Body copied verbatim from 20260730050000_quiz_engine.sql, plus the
-- eligibility raise placed BEFORE can_team_submit so the message is
-- "you're not on the list" rather than the generic "not currently open".
-- ===========================================================================

create or replace function public.start_quiz_attempt(p_team_id uuid, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_order uuid[];
  v_timers int[];
  v_total_seconds int;
  v_scheduled_ends_at timestamptz;
  v_attempt_id uuid;
  v_session_token uuid;
begin
  select * into v_round from public.rounds where id = p_round_id;
  if v_round.id is null or v_round.kind <> 'quiz' then
    raise exception '[not_found] Quiz round not found.';
  end if;

  -- 20260814050000: checked separately from can_team_submit (which also
  -- checks it) purely so the team sees an accurate reason.
  if not public.team_is_round_eligible(p_round_id, p_team_id) then
    raise exception '[not_eligible] Your team is not on the list for this round.';
  end if;

  if not public.can_team_submit(p_round_id, p_team_id) then
    raise exception '[quiz_not_open] This quiz is not currently open for your team.';
  end if;

  with shuffled as (
    select q.id, q.timer_seconds, row_number() over (order by random()) as ord
    from public.quiz_questions q
    where q.round_id = p_round_id and q.is_active
  )
  select array_agg(id order by ord), array_agg(timer_seconds order by ord), sum(timer_seconds)
  into v_order, v_timers, v_total_seconds
  from shuffled;

  if v_order is null or cardinality(v_order) < 1 then
    raise exception '[quiz_bank_invalid] The question bank is empty or misconfigured.';
  end if;

  -- Block late entry (adopted default): a truncated attempt is not
  -- comparable in the R1+R2 aggregate.
  if v_round.closes_at is not null
     and now() + make_interval(secs => v_total_seconds) > v_round.closes_at then
    raise exception '[quiz_too_late] Not enough time remains before the quiz closes to start a full attempt.';
  end if;

  v_scheduled_ends_at := least(
    now() + make_interval(secs => v_total_seconds),
    coalesce(v_round.closes_at, now() + make_interval(secs => v_total_seconds))
  );

  begin
    insert into public.quiz_attempts (
      round_id, team_id, event_edition_id, question_order, timer_seconds, scheduled_ends_at
    ) values (
      p_round_id, p_team_id, v_round.event_edition_id, v_order, v_timers, v_scheduled_ends_at
    )
    returning id, session_token into v_attempt_id, v_session_token;
  exception when unique_violation then
    raise exception '[attempt_already_exists] A quiz attempt already exists for your team.';
  end;

  perform public.log_activity(
    v_round.event_edition_id, p_team_id, 'team', 'quiz_attempt_started',
    jsonb_build_object('round_id', p_round_id, 'attempt_id', v_attempt_id)
  );

  return jsonb_build_object('attempt_id', v_attempt_id, 'session_token', v_session_token);
end;
$$;

-- ===========================================================================
-- PART B.5 — strike bookkeeping on the attempt
-- ===========================================================================

alter table public.quiz_attempts
  add column strike_count int not null default 0 check (strike_count >= 0),
  add column last_strike_at timestamptz,
  add column last_strike_kind text,
  add column warning_ack_at timestamptz;

comment on column public.quiz_attempts.strike_count is
  'Server-side on purpose. The lenient policy permits a refresh, so any '
  'client-held counter (React state, sessionStorage, a cookie) would be '
  'cleared by exactly the action we now allow — leniency would become '
  'infinite: tab out, refresh, tab out, forever. It must also survive a '
  'crash and a second device, and be visible to an admin mid-round.';

comment on column public.quiz_attempts.warning_ack_at is
  'Set when the team dismisses the blocking warning overlay. The overlay is '
  'shown whenever strike_count > 0 and (warning_ack_at is null or '
  'warning_ack_at < last_strike_at), which is what makes the warning survive '
  'a page refresh.';

-- ===========================================================================
-- PART B.6 — record_quiz_strike(): the single exit-policy engine
-- Strict rounds route through here too, so Round 1's "first signal submits"
-- semantics are preserved by DATA (quiz_exit_policy='strict'), not by a
-- second code path that could drift.
-- ===========================================================================

create or replace function public.record_quiz_strike(
  p_team_id uuid,
  p_round_id uuid,
  p_session_token uuid,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.quiz_attempts;
  v_round public.rounds;
  v_new_count int;
begin
  -- Deliberately narrower than quiz_attempts.submit_reason's allow-list:
  -- under the lenient policy these are the only two signals that may end an
  -- attempt at all. Fullscreen is not monitored, and a page unload resumes.
  if p_kind not in ('visibility_hidden', 'navigation') then
    raise exception '[invalid_strike_kind] Unknown strike kind.';
  end if;

  select * into v_attempt from public.quiz_attempts
  where round_id = p_round_id and team_id = p_team_id and status <> 'archived'
  for update;

  if v_attempt.id is null then
    return jsonb_build_object('status', 'no_attempt');
  end if;

  if v_attempt.status = 'submitted' then
    return jsonb_build_object('status', 'submitted', 'attempt_id', v_attempt.id);
  end if;

  if v_attempt.session_token <> p_session_token then
    return jsonb_build_object('status', 'session_replaced');
  end if;

  select * into v_round from public.rounds where id = p_round_id;

  -- Debounce. One physical exit can raise two signals — visibilitychange
  -- AND the Navigation API's 'navigate' — and alt-tab round trips
  -- double-fire on some browsers. Without this a single tab switch would
  -- burn both strikes at once and the "one warning" promise would be a lie.
  if v_attempt.last_strike_at is not null
     and v_attempt.last_strike_at > now() - interval '3 seconds' then
    insert into public.quiz_events (attempt_id, kind, detail)
    values (
      v_attempt.id, 'strike_debounced',
      jsonb_build_object('kind', p_kind, 'strike_count', v_attempt.strike_count)
    );
    return jsonb_build_object(
      'status', 'warned',
      'attempt_id', v_attempt.id,
      'strike_count', v_attempt.strike_count,
      'strike_limit', v_round.quiz_strike_limit,
      'strikes_remaining', greatest(v_round.quiz_strike_limit - v_attempt.strike_count, 0),
      'debounced', true
    );
  end if;

  v_new_count := v_attempt.strike_count + 1;

  update public.quiz_attempts set
    strike_count = v_new_count,
    last_strike_at = now(),
    last_strike_kind = p_kind,
    session_seen_at = now()
  where id = v_attempt.id;

  insert into public.quiz_events (attempt_id, kind, detail)
  values (
    v_attempt.id, p_kind,
    jsonb_build_object('strike_count', v_new_count, 'policy', v_round.quiz_exit_policy)
  );

  if v_round.quiz_exit_policy = 'strict' or v_new_count >= v_round.quiz_strike_limit then
    -- submit_quiz_attempt re-locks this same row FOR UPDATE inside the same
    -- transaction: a no-op re-acquisition, not a deadlock.
    return public.submit_quiz_attempt(p_team_id, p_round_id, p_kind, p_session_token)
           || jsonb_build_object('strike_count', v_new_count, 'ended_by_strike', true);
  end if;

  return jsonb_build_object(
    'status', 'warned',
    'attempt_id', v_attempt.id,
    'strike_count', v_new_count,
    'strike_limit', v_round.quiz_strike_limit,
    'strikes_remaining', v_round.quiz_strike_limit - v_new_count
  );
end;
$$;

revoke all on function public.record_quiz_strike(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_quiz_strike(uuid, uuid, uuid, text) to service_role;

create or replace function public.ack_quiz_warning(
  p_team_id uuid,
  p_round_id uuid,
  p_session_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.quiz_attempts;
begin
  select * into v_attempt from public.quiz_attempts
  where round_id = p_round_id and team_id = p_team_id and status = 'in_progress';

  if v_attempt.id is null or v_attempt.session_token <> p_session_token then
    return;
  end if;

  update public.quiz_attempts set
    warning_ack_at = now(),
    session_seen_at = now()
  where id = v_attempt.id;

  insert into public.quiz_events (attempt_id, kind, detail)
  values (
    v_attempt.id, 'warning_acknowledged',
    jsonb_build_object('strike_count', v_attempt.strike_count)
  );
end;
$$;

revoke all on function public.ack_quiz_warning(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ack_quiz_warning(uuid, uuid, uuid) to service_role;

-- ===========================================================================
-- PART B.7 — resume_quiz_attempt()
-- The session token lives only in client state, so a refresh loses it and
-- the runner falls back to preflight, where Start raises
-- [attempt_already_exists]. Handing the STORED token back would let two
-- devices poll the same attempt and defeat AT-QZ-05, so this rotates it
-- instead: the last loader owns the attempt and any stale tab gets the
-- existing [session_replaced] on its next poll — the designed behaviour,
-- now reachable through a supported button instead of a dead end.
-- ===========================================================================

create or replace function public.resume_quiz_attempt(p_team_id uuid, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_attempt public.quiz_attempts;
  v_token uuid;
begin
  select * into v_round from public.rounds where id = p_round_id;
  if v_round.id is null or v_round.kind <> 'quiz' then
    raise exception '[not_found] Quiz round not found.';
  end if;

  -- Round 1's recorded behaviour must stay bit-identical: no resume there.
  if v_round.quiz_exit_policy <> 'lenient' then
    raise exception '[resume_not_allowed] This round does not support resuming an attempt.';
  end if;

  select * into v_attempt from public.quiz_attempts
  where round_id = p_round_id and team_id = p_team_id and status <> 'archived'
  for update;

  if v_attempt.id is null then
    raise exception '[no_attempt] No quiz attempt to resume.';
  end if;

  if v_attempt.status = 'submitted' then
    return jsonb_build_object(
      'status', 'submitted',
      'attempt_id', v_attempt.id,
      'submitted_at', v_attempt.submitted_at
    );
  end if;

  v_token := gen_random_uuid();

  update public.quiz_attempts set
    session_token = v_token,
    session_seen_at = now()
  where id = v_attempt.id;

  insert into public.quiz_events (attempt_id, kind, detail)
  values (v_attempt.id, 'session_reclaimed', jsonb_build_object('via', 'resume'));

  return jsonb_build_object(
    'status', 'in_progress',
    'attempt_id', v_attempt.id,
    'session_token', v_token
  );
end;
$$;

revoke all on function public.resume_quiz_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resume_quiz_attempt(uuid, uuid) to service_role;

-- ===========================================================================
-- PART B.8 — get_quiz_state(): additive fields, same signature
--   * exit_policy / strike_count / strike_limit / warning_pending drive the
--     runner's policy branching and the blocking overlay.
--   * answered_count + question totals feed the Finish-&-submit confirm step
--     and the end-screen receipt.
--   * server_now is the clock reference for the runner's deadline watcher —
--     and fixes a latent bug where quiz-runner.tsx passed the CLIENT's clock
--     as serverNowAtMount into <Countdown/>, a component that exists purely
--     to correct client clock skew (the offset was always ~0).
-- Deliberately still does NOT return raw_score/percent: scores are
-- release-gated (published=false), so the receipt shows timing and counts
-- only.
-- ===========================================================================

create or replace function public.get_quiz_state(p_team_id uuid, p_round_id uuid, p_session_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.quiz_attempts;
  v_round public.rounds;
  v_idx int;
  v_closes_at timestamptz;
  v_question public.quiz_questions;
  v_options jsonb;
  v_saved_option uuid;
  v_answered int;
  v_warning_pending boolean;
begin
  select * into v_attempt from public.quiz_attempts
  where round_id = p_round_id and team_id = p_team_id and status <> 'archived';

  if v_attempt.id is null then
    raise exception '[no_attempt] No active quiz attempt.';
  end if;

  if v_attempt.session_token <> p_session_token then
    raise exception '[session_replaced] Your session was replaced — reload to reclaim if this was you.';
  end if;

  update public.quiz_attempts set session_seen_at = now() where id = v_attempt.id;

  select * into v_round from public.rounds where id = p_round_id;

  select count(*) into v_answered
  from public.quiz_answers where attempt_id = v_attempt.id;

  if v_attempt.status = 'submitted' then
    return jsonb_build_object(
      'status', 'submitted',
      'attempt_id', v_attempt.id,
      'submitted_at', v_attempt.submitted_at,
      'submit_reason', v_attempt.submit_reason,
      'answered_count', v_answered,
      'total', cardinality(v_attempt.question_order),
      'server_now', now()
    );
  end if;

  select idx, question_closes_at into v_idx, v_closes_at
  from public.quiz_current_index(v_attempt);

  if v_idx > cardinality(v_attempt.question_order) then
    return jsonb_build_object(
      'status', 'time_expired',
      'attempt_id', v_attempt.id,
      'answered_count', v_answered,
      'total', cardinality(v_attempt.question_order),
      'server_now', now()
    );
  end if;

  select * into v_question from public.quiz_questions where id = v_attempt.question_order[v_idx];

  select jsonb_agg(jsonb_build_object('id', o.id, 'position', o.position, 'label', o.label) order by o.position)
  into v_options
  from public.quiz_options o
  where o.question_id = v_question.id;

  select option_id into v_saved_option
  from public.quiz_answers
  where attempt_id = v_attempt.id and question_id = v_question.id;

  v_warning_pending := v_attempt.strike_count > 0
    and (v_attempt.warning_ack_at is null or v_attempt.warning_ack_at < v_attempt.last_strike_at);

  return jsonb_build_object(
    'status', 'in_progress',
    'attempt_id', v_attempt.id,
    'index', v_idx,
    'total', cardinality(v_attempt.question_order),
    'question', jsonb_build_object(
      'id', v_question.id,
      'prompt', v_question.prompt,
      'weight', v_question.weight,
      'options', coalesce(v_options, '[]'::jsonb)
    ),
    'closes_at', v_closes_at,
    'scheduled_ends_at', v_attempt.scheduled_ends_at,
    'saved_option_id', v_saved_option,
    'exit_policy', v_round.quiz_exit_policy,
    'strike_count', v_attempt.strike_count,
    'strike_limit', v_round.quiz_strike_limit,
    'warning_pending', v_warning_pending,
    'answered_count', v_answered,
    'server_now', now()
  );
end;
$$;

-- ===========================================================================
-- PART B.9 — submit_quiz_attempt(): populate the Part A counts, return the
-- receipt fields. The p_reason allow-list and the
-- `on conflict ... where public.scores.source = 'quiz'` guard are unchanged.
-- ===========================================================================

create or replace function public.submit_quiz_attempt(
  p_team_id uuid,
  p_round_id uuid,
  p_reason text,
  p_session_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.quiz_attempts;
  v_round public.rounds;
  v_raw numeric := 0;
  v_max numeric := 0;
  v_n int;
  v_i int;
  v_qid uuid;
  v_weight numeric;
  v_correct boolean;
  v_percent numeric;
  v_correct_count int := 0;
  v_answered int;
begin
  if p_reason not in (
    'completed', 'timeout', 'fullscreen_exit', 'visibility_hidden', 'page_hidden',
    'navigation', 'manual', 'admin'
  ) then
    raise exception '[invalid_reason] Unknown submit reason.';
  end if;

  select * into v_attempt from public.quiz_attempts
  where round_id = p_round_id and team_id = p_team_id and status <> 'archived'
  for update;

  if v_attempt.id is null then
    raise exception '[no_attempt] No quiz attempt exists for your team.';
  end if;

  if v_attempt.status = 'submitted' then
    select count(*) into v_answered
    from public.quiz_answers where attempt_id = v_attempt.id;

    return jsonb_build_object(
      'status', 'submitted', 'attempt_id', v_attempt.id,
      'raw_score', v_attempt.raw_score, 'max_score', v_attempt.max_score,
      'percent', v_attempt.percent,
      'correct_count', v_attempt.correct_count,
      'question_count', v_attempt.question_count,
      'answered_count', v_answered,
      'submitted_at', v_attempt.submitted_at,
      'submit_reason', v_attempt.submit_reason
    );
  end if;

  -- A stale token (from a tab whose session was reclaimed after a crash)
  -- is not authoritative once a fresher session exists — admin bypasses
  -- this for the manual reset/finalize path.
  if v_attempt.session_token <> p_session_token and p_reason <> 'admin' then
    raise exception '[session_replaced] Your session was replaced.';
  end if;

  v_n := cardinality(v_attempt.question_order);
  for v_i in 1..v_n loop
    v_qid := v_attempt.question_order[v_i];
    select weight into v_weight from public.quiz_questions where id = v_qid;
    v_max := v_max + coalesce(v_weight, 0);

    select o.is_correct into v_correct
    from public.quiz_answers a
    join public.quiz_options o on o.id = a.option_id
    where a.attempt_id = v_attempt.id and a.question_id = v_qid;

    if coalesce(v_correct, false) then
      v_raw := v_raw + v_weight;
      v_correct_count := v_correct_count + 1;
    end if;
  end loop;

  v_percent := case when v_max > 0 then round(v_raw / v_max * 100, 3) else 0 end;

  select count(*) into v_answered
  from public.quiz_answers where attempt_id = v_attempt.id;

  update public.quiz_attempts set
    status = 'submitted',
    submitted_at = now(),
    submit_reason = p_reason,
    raw_score = v_raw,
    max_score = v_max,
    percent = v_percent,
    correct_count = v_correct_count,
    question_count = v_n
  where id = v_attempt.id;

  select * into v_round from public.rounds where id = p_round_id;

  -- Release-gated (locked decision): lands in scores immediately with
  -- published = false, exactly like Rounds 2-4 — SCR-05/SUB-07/AT-SCR-03
  -- stay uniform across every round.
  insert into public.scores (round_id, team_id, total, max_total, source, published)
  values (p_round_id, p_team_id, v_raw, v_max, 'quiz', false)
  on conflict (round_id, team_id)
    do update set total = v_raw, max_total = v_max, source = 'quiz', updated_at = now()
    where public.scores.source = 'quiz';

  perform public.log_activity(
    v_round.event_edition_id, p_team_id, 'team', 'quiz_attempt_submitted',
    jsonb_build_object('round_id', p_round_id, 'attempt_id', v_attempt.id, 'reason', p_reason)
  );

  return jsonb_build_object(
    'status', 'submitted', 'attempt_id', v_attempt.id,
    'raw_score', v_raw, 'max_score', v_max, 'percent', v_percent,
    'correct_count', v_correct_count,
    'question_count', v_n,
    'answered_count', v_answered,
    'submitted_at', now(),
    'submit_reason', p_reason
  );
end;
$$;

-- ===========================================================================
-- PART B.10 — stage_standings(): honour supersedes_round_id
-- Same OUT columns, same tie-break vocabulary, same adjustments handling.
-- Only score selection changes: a round that some OTHER round in this stage
-- supersedes contributes nothing for the teams that have a score row in the
-- superseding round. Both scores rows stay on record.
-- ===========================================================================

create or replace function public.stage_standings(p_stage_id uuid)
returns table (team_id uuid, team_name citext, aggregate numeric, rank int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule1 jsonb;
  v_rule2 jsonb;
  v_event_edition_id uuid;
begin
  select tie_breaker_rules -> 0, tie_breaker_rules -> 1, event_edition_id
  into v_rule1, v_rule2, v_event_edition_id
  from public.stages where id = p_stage_id;

  return query
  with round_scores as (
    select sr.round_id, sr.weight, r.supersedes_round_id
    from public.stage_rounds sr
    join public.rounds r on r.id = sr.round_id
    where sr.stage_id = p_stage_id
  ),
  -- Rounds in THIS stage that some other round in this stage replaces.
  superseded as (
    select distinct rs.supersedes_round_id as round_id
    from round_scores rs
    where rs.supersedes_round_id is not null
  ),
  contributions as (
    select t.id as team_id, rs.round_id, rs.weight, coalesce(s.total, 0) as total
    from public.teams t
    cross join round_scores rs
    left join public.scores s on s.round_id = rs.round_id and s.team_id = t.id
    where t.event_edition_id = v_event_edition_id
  ),
  effective as (
    select c.*
    from contributions c
    where c.round_id not in (select sup.round_id from superseded sup)
       or not exists (
            select 1
            from round_scores rs2
            join public.scores s2
              on s2.round_id = rs2.round_id and s2.team_id = c.team_id
            where rs2.supersedes_round_id = c.round_id
          )
  ),
  weighted as (
    -- LEFT JOIN from teams rather than grouping over `effective`, so a team
    -- whose every contribution was filtered out still ranks with 0 instead
    -- of vanishing from the standings (SCR-01/02/07).
    select t.id as team_id,
           coalesce(sum(e.total * e.weight), 0) as weighted_total
    from public.teams t
    left join effective e on e.team_id = t.id
    where t.event_edition_id = v_event_edition_id
    group by t.id
  ),
  adjustments as (
    -- Table-qualified: stage_standings' OUT parameter is also named
    -- team_id, and PL/pgSQL treats a bare column reference here as
    -- ambiguous between the two rather than resolving it to the table.
    select stage_adjustments.team_id, sum(amount) as adj_total
    from public.stage_adjustments
    where stage_id = p_stage_id
    group by stage_adjustments.team_id
  ),
  tie1 as (
    select s.team_id, s.total as v
    from public.scores s
    where v_rule1 is not null
      and v_rule1 ->> 'kind' = 'higher_round_score'
      and s.round_id = (v_rule1 ->> 'round_id')::uuid
  ),
  tie2 as (
    select sub.team_id, sub.submitted_at as v
    from public.submissions sub
    where v_rule2 is not null
      and v_rule2 ->> 'kind' = 'earlier_submission'
      and sub.round_id = (v_rule2 ->> 'round_id')::uuid
  )
  select
    w.team_id,
    tm.name,
    (w.weighted_total + coalesce(a.adj_total, 0))::numeric as aggregate,
    (rank() over (
      order by w.weighted_total + coalesce(a.adj_total, 0) desc,
               t1.v desc nulls last,
               t2.v asc nulls last
    ))::int as rank
  from weighted w
  join public.teams tm on tm.id = w.team_id
  left join adjustments a on a.team_id = w.team_id
  left join tie1 t1 on t1.team_id = w.team_id
  left join tie2 t2 on t2.team_id = w.team_id
  order by aggregate desc;
end;
$$;

comment on function public.stage_standings(uuid) is
  'SCR-01/02/07: a team with no score for a contributing round is ranked '
  'with that component as 0, never silently excluded. Tie-breaker rules '
  'are a small closed vocabulary (see stages.tie_breaker_rules), not open '
  'SQL — "higher_round_score" and "earlier_submission" are the only kinds '
  'understood here today. Scoped to the stage''s own event_edition_id '
  '(20260807090000). As of 20260814050000, a round carrying '
  'supersedes_round_id replaces the referenced round for any team holding a '
  'score row in it — how the Round 1 re-attempt counts INSTEAD of (never in '
  'addition to) the original Stat Sprint score.';

-- ===========================================================================
-- PART B.11 — admin RPCs for the allowlist and the round policy
-- ===========================================================================

create or replace function public.admin_set_round_eligibility(
  p_round_id uuid,
  p_team_ids uuid[],
  p_admin_id uuid default null,
  p_reason text default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_locked text;
  v_count int;
  v_ids uuid[] := coalesce(p_team_ids, '{}'::uuid[]);
begin
  select * into v_round from public.rounds where id = p_round_id;
  if v_round.id is null then
    raise exception '[not_found] Round not found.';
  end if;

  -- Never strip eligibility from a team that is already mid-attempt: their
  -- in-flight attempt would start failing can_team_submit checks.
  select string_agg(t.name::text, ', ') into v_locked
  from public.round_eligible_teams ret
  join public.quiz_attempts qa
    on qa.round_id = ret.round_id and qa.team_id = ret.team_id and qa.status <> 'archived'
  join public.teams t on t.id = ret.team_id
  where ret.round_id = p_round_id
    and not (ret.team_id = any (v_ids));

  if v_locked is not null then
    raise exception
      '[eligibility_locked] These teams already have an attempt and cannot be removed: %', v_locked;
  end if;

  delete from public.round_eligible_teams
  where round_id = p_round_id
    and not (team_id = any (v_ids));

  insert into public.round_eligible_teams (round_id, team_id, event_edition_id, reason, added_by)
  select p_round_id, t.id, v_round.event_edition_id, p_reason, p_admin_id
  from public.teams t
  where t.id = any (v_ids)
    and t.event_edition_id = v_round.event_edition_id
  on conflict (round_id, team_id) do nothing;

  select count(*) into v_count
  from public.round_eligible_teams where round_id = p_round_id;

  perform public.log_activity(
    v_round.event_edition_id, null, 'admin', 'round_eligibility_set',
    jsonb_build_object('round_id', p_round_id, 'team_count', v_count, 'reason', p_reason)
  );
  perform public.broadcast_live(
    v_round.event_edition_id, 'rounds', 'round_eligibility_changed',
    jsonb_build_object('round_id', p_round_id)
  );

  return v_count;
end;
$$;

revoke all on function public.admin_set_round_eligibility(uuid, uuid[], uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_round_eligibility(uuid, uuid[], uuid, text) to service_role;

create or replace function public.admin_add_round_eligible_team(
  p_round_id uuid,
  p_team_id uuid,
  p_reason text default null,
  p_admin_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  select * into v_round from public.rounds where id = p_round_id;
  if v_round.id is null then
    raise exception '[not_found] Round not found.';
  end if;

  if not exists (
    select 1 from public.teams
    where id = p_team_id and event_edition_id = v_round.event_edition_id
  ) then
    raise exception '[not_found] Team not found in this edition.';
  end if;

  insert into public.round_eligible_teams (round_id, team_id, event_edition_id, reason, added_by)
  values (p_round_id, p_team_id, v_round.event_edition_id, p_reason, p_admin_id)
  on conflict (round_id, team_id) do nothing;

  perform public.log_activity(
    v_round.event_edition_id, p_team_id, 'admin', 'round_eligibility_added',
    jsonb_build_object('round_id', p_round_id, 'reason', p_reason)
  );
  perform public.broadcast_live(
    v_round.event_edition_id, 'rounds', 'round_eligibility_changed',
    jsonb_build_object('round_id', p_round_id)
  );
end;
$$;

revoke all on function public.admin_add_round_eligible_team(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_add_round_eligible_team(uuid, uuid, text, uuid) to service_role;

create or replace function public.admin_remove_round_eligible_team(
  p_round_id uuid,
  p_team_id uuid,
  p_admin_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_name text;
begin
  select * into v_round from public.rounds where id = p_round_id;
  if v_round.id is null then
    raise exception '[not_found] Round not found.';
  end if;

  select t.name::text into v_name
  from public.quiz_attempts qa
  join public.teams t on t.id = qa.team_id
  where qa.round_id = p_round_id and qa.team_id = p_team_id and qa.status <> 'archived';

  if v_name is not null then
    raise exception
      '[eligibility_locked] These teams already have an attempt and cannot be removed: %', v_name;
  end if;

  delete from public.round_eligible_teams
  where round_id = p_round_id and team_id = p_team_id;

  perform public.log_activity(
    v_round.event_edition_id, p_team_id, 'admin', 'round_eligibility_removed',
    jsonb_build_object('round_id', p_round_id)
  );
  perform public.broadcast_live(
    v_round.event_edition_id, 'rounds', 'round_eligibility_changed',
    jsonb_build_object('round_id', p_round_id)
  );
end;
$$;

revoke all on function public.admin_remove_round_eligible_team(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_remove_round_eligible_team(uuid, uuid, uuid) to service_role;

-- Deliberately a separate setter rather than four more parameters on
-- admin_upsert_round: adding params with defaults there would create an
-- overload, precisely the bug class 20260807090000 exists to fix, and
-- avoiding it would mean a drop+recreate+re-grant on a hot RPC while Round 1
-- is open.
create or replace function public.admin_set_round_policy(
  p_round_id uuid,
  p_supersedes_round_id uuid,
  p_is_invite_only boolean,
  p_quiz_exit_policy text,
  p_quiz_strike_limit int,
  p_admin_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  select * into v_round from public.rounds where id = p_round_id;
  if v_round.id is null then
    raise exception '[not_found] Round not found.';
  end if;

  if p_quiz_exit_policy not in ('strict', 'lenient') then
    raise exception '[invalid_policy] Exit policy must be strict or lenient.';
  end if;

  if p_quiz_strike_limit is null or p_quiz_strike_limit < 1 or p_quiz_strike_limit > 5 then
    raise exception '[invalid_policy] Strike limit must be between 1 and 5.';
  end if;

  if p_supersedes_round_id is not null then
    if p_supersedes_round_id = p_round_id then
      raise exception '[invalid_supersede] A round cannot supersede itself.';
    end if;

    if not exists (
      select 1 from public.rounds
      where id = p_supersedes_round_id and event_edition_id = v_round.event_edition_id
    ) then
      raise exception '[invalid_supersede] The superseded round must be in the same edition.';
    end if;
  end if;

  update public.rounds set
    supersedes_round_id = p_supersedes_round_id,
    is_invite_only = coalesce(p_is_invite_only, false),
    quiz_exit_policy = p_quiz_exit_policy,
    quiz_strike_limit = p_quiz_strike_limit,
    updated_at = now()
  where id = p_round_id;

  perform public.log_activity(
    v_round.event_edition_id, null, 'admin', 'round_policy_set',
    jsonb_build_object(
      'round_id', p_round_id,
      'supersedes_round_id', p_supersedes_round_id,
      'is_invite_only', p_is_invite_only,
      'quiz_exit_policy', p_quiz_exit_policy,
      'quiz_strike_limit', p_quiz_strike_limit,
      'admin_id', p_admin_id
    )
  );
  perform public.broadcast_live(
    v_round.event_edition_id, 'rounds', 'round_policy_changed',
    jsonb_build_object('round_id', p_round_id)
  );
end;
$$;

revoke all on function public.admin_set_round_policy(uuid, uuid, boolean, text, int, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_round_policy(uuid, uuid, boolean, text, int, uuid) to service_role;

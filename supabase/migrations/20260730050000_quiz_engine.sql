-- Migration 004 — Round 1 quiz engine (lockstep schedule)
-- MCQ-only, one continuous attempt, per-question timer, same question set
-- randomised independently per team, autosave, server-authoritative state.
-- Timing model: once a team starts, question k's window is a pure function
-- of the clock (started_at + prefix sums of a snapshotted timer array) —
-- there is no mutable per-question timer to stall, so QZ-14/16 hold by
-- construction. No advance_quiz_question RPC exists; that entire tamper
-- surface is deleted rather than defended.
--
-- PRD references: §10/§10.1/§10.2, QZ-01..16, SEC-05, ERR-04/05,
-- §28.2 (AT-QZ-01..05).

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Quiz questions and options
-- ---------------------------------------------------------------------------

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  position int not null,
  prompt text not null,
  timer_seconds int not null default 60 check (timer_seconds between 5 and 900),
  weight numeric(6, 2) not null default 1 check (weight > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_questions_round_position_unique unique (round_id, position)
);

comment on table public.quiz_questions is
  'QZ-03: no is_starred column — the star icon is purely weight > 1, '
  'derived in the UI, so star and weight can never disagree.';

create index quiz_questions_round_active_idx
  on public.quiz_questions (round_id)
  where is_active;

create trigger set_updated_at
  before update on public.quiz_questions
  for each row execute function public.set_updated_at();

alter table public.quiz_questions enable row level security;

create policy "quiz_questions_admin_all"
  on public.quiz_questions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table public.quiz_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  position int not null,
  label text not null,
  is_correct boolean not null default false,
  constraint quiz_options_question_position_unique unique (question_id, position)
);

comment on table public.quiz_options is
  'Anti-cheat crux: admin-only select under RLS, no team policy at all. '
  'Correctness never reaches the browser except through get_quiz_state''s '
  'curated jsonb, which never projects is_correct.';

alter table public.quiz_options enable row level security;

create policy "quiz_options_admin_all"
  on public.quiz_options for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Quiz attempts — question_order/timer_seconds are a materialised snapshot,
-- not a reproducible seed, so an admin editing the bank mid-window cannot
-- silently shift an in-flight attempt's schedule.
-- ---------------------------------------------------------------------------

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  question_order uuid[] not null,
  timer_seconds int[] not null,
  started_at timestamptz not null default now(),
  scheduled_ends_at timestamptz not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'archived')),
  submitted_at timestamptz,
  submit_reason text check (submit_reason in (
    'completed', 'timeout', 'fullscreen_exit', 'visibility_hidden', 'page_hidden',
    'navigation', 'manual', 'admin'
  )),
  raw_score numeric(10, 2),
  max_score numeric(10, 2),
  percent numeric(6, 3),
  session_token uuid not null default gen_random_uuid(),
  session_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_attempts_arrays_aligned check (
    cardinality(question_order) = cardinality(timer_seconds) and cardinality(question_order) > 0
  ),
  constraint quiz_attempts_submitted_consistency check ((status = 'submitted') = (submitted_at is not null)),
  constraint quiz_attempts_scored_when_submitted check (status <> 'submitted' or raw_score is not null)
);

comment on table public.quiz_attempts is
  'QZ-08: "one continuous attempt" is structural via the partial unique '
  'index below, not just RPC logic. started_at is never updated once set — '
  'the schedule anchor is immutable, which is the whole lockstep model.';

-- QZ-08/QZ-15: at most one non-archived attempt per (round, team) ever —
-- a partial index (not a plain unique constraint) so admin_reset_quiz_attempt
-- can archive a stuck attempt and let a fresh one be created without
-- deleting history.
create unique index quiz_attempts_round_team_active_unique
  on public.quiz_attempts (round_id, team_id)
  where status <> 'archived';

create index quiz_attempts_open_idx
  on public.quiz_attempts (scheduled_ends_at)
  where status = 'in_progress';

create index quiz_attempts_round_status_idx
  on public.quiz_attempts (round_id, status);

create trigger set_updated_at
  before update on public.quiz_attempts
  for each row execute function public.set_updated_at();

alter table public.quiz_attempts enable row level security;

create policy "quiz_attempts_select_own_or_admin"
  on public.quiz_attempts for select
  to authenticated
  using (team_id = (select auth.uid()) or public.is_admin());

create policy "quiz_attempts_admin_write"
  on public.quiz_attempts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts (id) on delete cascade,
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  option_id uuid not null references public.quiz_options (id) on delete cascade,
  answered_at timestamptz not null default now(),
  constraint quiz_answers_attempt_question_unique unique (attempt_id, question_id)
);

comment on table public.quiz_answers is
  'QZ-09: changeable for the whole duration of a question''s window — '
  'save_quiz_answer upserts on (attempt_id, question_id).';

alter table public.quiz_answers enable row level security;

create policy "quiz_answers_select_own_or_admin"
  on public.quiz_answers for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.quiz_attempts a
      where a.id = quiz_answers.attempt_id and a.team_id = (select auth.uid())
    )
  );

create policy "quiz_answers_admin_write"
  on public.quiz_answers for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table public.quiz_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts (id) on delete cascade,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.quiz_events is
  'QZ-13, ERR-04/05: append-only exit/reconnect audit — fullscreen_exit, '
  'visibility_hidden, page_hidden, heartbeat, session_reclaimed, etc.';

create index quiz_events_attempt_id_idx on public.quiz_events (attempt_id);

alter table public.quiz_events enable row level security;

create policy "quiz_events_select_own_or_admin"
  on public.quiz_events for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.quiz_attempts a
      where a.id = quiz_events.attempt_id and a.team_id = (select auth.uid())
    )
  );

create policy "quiz_events_admin_write"
  on public.quiz_events for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- quiz_current_index() — the one schedule formula every caller shares.
-- Pure function of started_at + the snapshotted timer array; nothing to
-- advance server-side because there is nothing mutable to advance.
-- ---------------------------------------------------------------------------

create or replace function public.quiz_current_index(p_attempt public.quiz_attempts)
returns table (idx int, question_closes_at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_elapsed numeric;
  v_cursor numeric := 0;
  v_i int;
  v_n int;
begin
  v_elapsed := extract(epoch from (now() - p_attempt.started_at));
  v_n := cardinality(p_attempt.timer_seconds);

  for v_i in 1..v_n loop
    v_cursor := v_cursor + p_attempt.timer_seconds[v_i];
    if v_elapsed < v_cursor then
      idx := v_i;
      question_closes_at := p_attempt.started_at + make_interval(secs => v_cursor);
      return next;
      return;
    end if;
  end loop;

  -- Past the end of the schedule: n+1 sentinel signals "time_expired".
  idx := v_n + 1;
  question_closes_at := p_attempt.started_at + make_interval(secs => v_cursor);
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- start_quiz_attempt()
-- ---------------------------------------------------------------------------

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

comment on function public.start_quiz_attempt(uuid, uuid) is
  'QZ-05/08/15: independent per-team shuffle via row_number() over (order '
  'by random()), snapshotted immediately so it cannot drift under an '
  'in-flight attempt. The unique index makes a second concurrent call fail '
  'cleanly (QZ-15) at the database level.';

-- ---------------------------------------------------------------------------
-- get_quiz_state() — pure read. Reconnecting after 8 minutes away is one
-- SELECT, not an iterative catch-up loop, because there is nothing to
-- catch up.
-- ---------------------------------------------------------------------------

create or replace function public.get_quiz_state(p_team_id uuid, p_round_id uuid, p_session_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.quiz_attempts;
  v_idx int;
  v_closes_at timestamptz;
  v_question public.quiz_questions;
  v_options jsonb;
  v_saved_option uuid;
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

  if v_attempt.status = 'submitted' then
    return jsonb_build_object('status', 'submitted', 'attempt_id', v_attempt.id, 'submitted_at', v_attempt.submitted_at);
  end if;

  select idx, question_closes_at into v_idx, v_closes_at from public.quiz_current_index(v_attempt);

  if v_idx > cardinality(v_attempt.question_order) then
    return jsonb_build_object('status', 'time_expired', 'attempt_id', v_attempt.id);
  end if;

  select * into v_question from public.quiz_questions where id = v_attempt.question_order[v_idx];

  select jsonb_agg(jsonb_build_object('id', o.id, 'position', o.position, 'label', o.label) order by o.position)
  into v_options
  from public.quiz_options o
  where o.question_id = v_question.id;

  select option_id into v_saved_option
  from public.quiz_answers
  where attempt_id = v_attempt.id and question_id = v_question.id;

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
    'saved_option_id', v_saved_option
  );
end;
$$;

comment on function public.get_quiz_state(uuid, uuid, uuid) is
  'QZ-16: never trusts the client clock — index/closes_at are always '
  'recomputed from started_at + now(). Never projects quiz_options.is_correct.';

-- ---------------------------------------------------------------------------
-- save_quiz_answer()
-- ---------------------------------------------------------------------------

create or replace function public.save_quiz_answer(
  p_team_id uuid,
  p_round_id uuid,
  p_session_token uuid,
  p_question_id uuid,
  p_option_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.quiz_attempts;
  v_idx int;
  v_closes_at timestamptz;
begin
  select * into v_attempt from public.quiz_attempts
  where round_id = p_round_id and team_id = p_team_id and status = 'in_progress';

  if v_attempt.id is null then
    raise exception '[no_attempt] No active quiz attempt.';
  end if;

  if v_attempt.session_token <> p_session_token then
    raise exception '[session_replaced] Your session was replaced.';
  end if;

  select idx, question_closes_at into v_idx, v_closes_at from public.quiz_current_index(v_attempt);

  if v_idx > cardinality(v_attempt.question_order) or v_attempt.question_order[v_idx] <> p_question_id then
    raise exception '[question_window_closed] This question''s window has already elapsed.';
  end if;

  if not exists (select 1 from public.quiz_options where id = p_option_id and question_id = p_question_id) then
    raise exception '[invalid_option] That option does not belong to this question.';
  end if;

  update public.quiz_attempts set session_seen_at = now() where id = v_attempt.id;

  insert into public.quiz_answers (attempt_id, question_id, option_id)
  values (v_attempt.id, p_question_id, p_option_id)
  on conflict (attempt_id, question_id)
    do update set option_id = excluded.option_id, answered_at = now();
end;
$$;

comment on function public.save_quiz_answer(uuid, uuid, uuid, uuid, uuid) is
  'QZ-09: autosave after every answer change, rejected once the question''s '
  'own window has elapsed (QZ-16).';

-- ---------------------------------------------------------------------------
-- submit_quiz_attempt() — idempotent. A beacon, a visibilitychange and a
-- fullscreenchange can all fire for the same exit; a second call against an
-- already-submitted attempt is a no-op returning the existing result.
-- ---------------------------------------------------------------------------

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
    return jsonb_build_object(
      'status', 'submitted', 'attempt_id', v_attempt.id,
      'raw_score', v_attempt.raw_score, 'max_score', v_attempt.max_score, 'percent', v_attempt.percent
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
    end if;
  end loop;

  v_percent := case when v_max > 0 then round(v_raw / v_max * 100, 3) else 0 end;

  update public.quiz_attempts set
    status = 'submitted',
    submitted_at = now(),
    submit_reason = p_reason,
    raw_score = v_raw,
    max_score = v_max,
    percent = v_percent
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

  return jsonb_build_object('status', 'submitted', 'attempt_id', v_attempt.id, 'raw_score', v_raw, 'max_score', v_max, 'percent', v_percent);
end;
$$;

comment on function public.submit_quiz_attempt(uuid, uuid, text, uuid) is
  'QZ-02/03, AT-QZ-02/04: idempotent scoring pass, weighted by '
  'quiz_questions.weight. Writes scores.source = ''quiz'' so R1 counts in '
  'the R1+R2 aggregate (see migration 003''s stage_rounds).';

-- ---------------------------------------------------------------------------
-- log_quiz_events() — batched, called from the sendBeacon Route Handler.
-- ---------------------------------------------------------------------------

create or replace function public.log_quiz_events(
  p_team_id uuid,
  p_round_id uuid,
  p_session_token uuid,
  p_events jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_evt jsonb;
  v_count int := 0;
begin
  select id into v_attempt_id from public.quiz_attempts
  where round_id = p_round_id and team_id = p_team_id
    and session_token = p_session_token and status <> 'archived';

  if v_attempt_id is null then
    return 0;
  end if;

  for v_evt in select * from jsonb_array_elements(p_events) loop
    insert into public.quiz_events (attempt_id, kind, detail)
    values (v_attempt_id, v_evt ->> 'kind', coalesce(v_evt -> 'detail', '{}'::jsonb));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- tick_quiz_attempts() — cron backstop for a team that crashes/closes the
-- tab without a beacon ever firing. Advisory in the same sense as
-- principle #3: it materializes a result already computed from already-
-- saved answers and elapsed time; nothing here is a new decision.
-- ---------------------------------------------------------------------------

create or replace function public.tick_quiz_attempts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt record;
  v_count int := 0;
begin
  for v_attempt in
    select round_id, team_id, session_token
    from public.quiz_attempts
    where status = 'in_progress' and scheduled_ends_at < now() - interval '30 seconds'
  loop
    perform public.submit_quiz_attempt(v_attempt.team_id, v_attempt.round_id, 'timeout', v_attempt.session_token);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

select cron.schedule('tick-quiz-attempts', '* * * * *', $cron$select public.tick_quiz_attempts();$cron$);

-- ---------------------------------------------------------------------------
-- admin_reset_quiz_attempt() — the escape hatch for a genuine hardware/
-- venue failure. A fairness policy, not a normal path.
-- ---------------------------------------------------------------------------

create or replace function public.admin_reset_quiz_attempt(p_attempt_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.quiz_attempts;
begin
  select * into v_attempt from public.quiz_attempts where id = p_attempt_id;
  if v_attempt.id is null then
    raise exception '[not_found] Attempt not found.';
  end if;

  update public.quiz_attempts set status = 'archived' where id = p_attempt_id;

  perform public.log_activity(
    v_attempt.event_edition_id, v_attempt.team_id, 'admin', 'quiz_attempt_reset',
    jsonb_build_object('attempt_id', p_attempt_id, 'reason', p_reason)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin question bank CRUD + bank validation
-- ---------------------------------------------------------------------------

create or replace function public.validate_quiz_bank(p_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_problems jsonb := '[]'::jsonb;
  v_q record;
begin
  for v_q in
    select q.id, q.position,
           count(o.id) as option_count,
           count(*) filter (where o.is_correct) as correct_count
    from public.quiz_questions q
    left join public.quiz_options o on o.question_id = q.id
    where q.round_id = p_round_id and q.is_active
    group by q.id, q.position
  loop
    if v_q.option_count < 2 then
      v_problems := v_problems || jsonb_build_object(
        'question_id', v_q.id, 'position', v_q.position, 'problem', 'fewer_than_two_options'
      );
    end if;
    if v_q.correct_count <> 1 then
      v_problems := v_problems || jsonb_build_object(
        'question_id', v_q.id, 'position', v_q.position, 'problem', 'not_exactly_one_correct_option'
      );
    end if;
  end loop;

  if not exists (select 1 from public.quiz_questions where round_id = p_round_id and is_active) then
    v_problems := v_problems || jsonb_build_object('problem', 'no_active_questions');
  end if;

  return v_problems;
end;
$$;

comment on function public.validate_quiz_bank(uuid) is
  '"Exactly one correct option, at least two options" cannot be a table '
  'CHECK (same reasoning as team_members cardinality in migration 002). '
  'This is the admin-UI-facing check; start_quiz_attempt also hard-gates '
  'on [quiz_bank_invalid] as a last line of defense.';

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
    insert into public.quiz_questions (round_id, event_edition_id, position, prompt, timer_seconds, weight, is_active)
    values (p_round_id, v_event_edition_id, p_position, p_prompt, p_timer_seconds, p_weight, p_is_active)
    returning id into v_question_id;
  end if;

  for v_opt in select * from jsonb_array_elements(p_options) loop
    insert into public.quiz_options (question_id, position, label, is_correct)
    values (v_question_id, (v_opt ->> 'position')::int, v_opt ->> 'label', (v_opt ->> 'is_correct')::boolean);
  end loop;

  return v_question_id;
end;
$$;

create or replace function public.admin_delete_quiz_question(p_question_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.quiz_questions where id = p_question_id;
$$;

-- ---------------------------------------------------------------------------
-- Grants — every RPC here is service_role only (same rationale as
-- migrations 002/003). Unlike can_team_submit, none of these are granted
-- to authenticated directly: even read-only get_quiz_state goes through a
-- Server Action / Route Handler, per architecture principle #2.
-- ---------------------------------------------------------------------------

revoke all on function public.start_quiz_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_quiz_attempt(uuid, uuid) to service_role;

revoke all on function public.get_quiz_state(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_quiz_state(uuid, uuid, uuid) to service_role;

revoke all on function public.save_quiz_answer(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_quiz_answer(uuid, uuid, uuid, uuid, uuid) to service_role;

revoke all on function public.submit_quiz_attempt(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_quiz_attempt(uuid, uuid, text, uuid) to service_role;

revoke all on function public.log_quiz_events(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.log_quiz_events(uuid, uuid, uuid, jsonb) to service_role;

revoke all on function public.admin_reset_quiz_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_reset_quiz_attempt(uuid, text) to service_role;

revoke all on function public.validate_quiz_bank(uuid) from public, anon, authenticated;
grant execute on function public.validate_quiz_bank(uuid) to service_role;

revoke all on function public.admin_upsert_quiz_question(uuid, uuid, int, text, int, numeric, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.admin_upsert_quiz_question(uuid, uuid, int, text, int, numeric, boolean, jsonb) to service_role;

revoke all on function public.admin_delete_quiz_question(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_quiz_question(uuid) to service_role;

-- tick_quiz_attempts() is invoked only by pg_cron (as the job owner, not a
-- request role) — it must not be directly callable by anon/authenticated,
-- even though it only affects already-expired attempts.
revoke all on function public.tick_quiz_attempts() from public, anon, authenticated;
grant execute on function public.tick_quiz_attempts() to service_role;

-- quiz_current_index() takes a quiz_attempts row argument like
-- effective_round_status() takes a rounds row — not directly callable via
-- PostgREST, left at its default public-executable grant.

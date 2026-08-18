-- Migration — makes the simulation's winner cap configurable per config
-- row instead of a literal "2" baked into a check constraint and two
-- functions. Requested change: the live event's simulation should stop at
-- 4 winners (one per generated answer key, SIM-05) instead of 2.
--
-- Additive only: max_winners defaults to 2, so every existing config row
-- (including the ones tests insert directly without naming the column)
-- keeps today's "first two correct submissions win" behaviour unless
-- explicitly bumped. No table is rewritten, no attempt/reward row is
-- touched, and admin_save_simulation_config's new parameter is trailing
-- with a default, so existing call sites (seed_simulation_config, any
-- already-deployed client bundle mid-rollout) keep working unmodified.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The cap becomes data, not a literal.
-- ---------------------------------------------------------------------------

alter table public.simulation_config
  add column max_winners int not null default 2
  check (max_winners between 1 and 4);

comment on column public.simulation_config.max_winners is
  'SIM-07 winner cap for this config row. Bounded at 4 because exactly 4 '
  'answer keys are ever generated (simulation_generate_answer_key) — a '
  'cap above 4 could never be reached and would make "distinct winner '
  'per key" ambiguous.';

-- winner_rank's check constraint hardcoded "in (1, 2)" — widen it to the
-- same [1,4] bound as max_winners. A per-row dynamic check referencing
-- max_winners isn't expressible as a plain column check, so this widened
-- static bound is enforced together with the runtime max_winners compare
-- inside submit_simulation_attempt() below (belt and suspenders: the
-- function is the real gate, this constraint just blocks garbage values).
alter table public.simulation_attempts
  drop constraint simulation_attempts_winner_rank_check;

alter table public.simulation_attempts
  add constraint simulation_attempts_winner_rank_check
  check (winner_rank between 1 and 4);

-- ---------------------------------------------------------------------------
-- 2. simulation_status() — "stopped once winner_count >= 2" becomes
--    "...>= max_winners". Also surfaces max_winners itself so the team
--    console/admin panel can render "N / max" without a second query.
-- ---------------------------------------------------------------------------

create or replace function public.simulation_status(p_config_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.simulation_config;
  v_status text;
begin
  select * into v_config from public.simulation_config where id = p_config_id;
  if v_config.id is null then
    raise exception '[not_found] Simulation config not found.';
  end if;

  if v_config.stopped_at is not null then
    v_status := 'stopped';
  elsif v_config.started_at is not null
        and now() >= v_config.started_at + make_interval(secs => v_config.global_timer_seconds) then
    v_status := 'stopped';
  elsif v_config.winner_count >= v_config.max_winners then
    v_status := 'stopped';
  elsif v_config.started_at is not null then
    v_status := 'active';
  else
    v_status := 'not_started';
  end if;

  return jsonb_build_object(
    'config_id', v_config.id,
    'status', v_status,
    'parameters', v_config.parameters,
    'started_at', v_config.started_at,
    'ends_at', case when v_config.started_at is not null
      then v_config.started_at + make_interval(secs => v_config.global_timer_seconds)
      else null
    end,
    'submit_cooldown_seconds', v_config.submit_cooldown_seconds,
    'winner_count', v_config.winner_count,
    'max_winners', v_config.max_winners
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. submit_simulation_attempt() — the two literal "2"s become
--    v_config.max_winners. Everything else (row lock, unique partial
--    index, cooldown, calibration guard) is untouched.
-- ---------------------------------------------------------------------------

create or replace function public.submit_simulation_attempt(
  p_team_id uuid,
  p_config_id uuid,
  p_parameters jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.simulation_config;
  v_last_attempt timestamptz;
  v_eval jsonb;
  v_winner_rank int;
  v_attempt_id uuid;
begin
  select * into v_config from public.simulation_config where id = p_config_id for update;
  if v_config.id is null then
    raise exception '[not_found] Simulation config not found.';
  end if;

  if v_config.started_at is null then
    raise exception '[simulation_not_started] The simulation has not started yet.';
  end if;
  if v_config.stopped_at is not null then
    raise exception '[simulation_stopped] The simulation has been stopped.';
  end if;
  if now() >= v_config.started_at + make_interval(secs => v_config.global_timer_seconds) then
    raise exception '[simulation_timer_expired] The simulation timer has expired.';
  end if;
  if v_config.winner_count >= v_config.max_winners then
    raise exception '[simulation_already_won] % winners have already been confirmed.', v_config.max_winners;
  end if;
  if v_config.defaults_overall <> 70 then
    raise exception '[simulation_config_invalid] This simulation''s configuration failed calibration.';
  end if;

  select server_ts into v_last_attempt
  from public.simulation_attempts
  where config_id = p_config_id and team_id = p_team_id
  order by server_ts desc
  limit 1;

  if v_last_attempt is not null
     and now() < v_last_attempt + make_interval(secs => v_config.submit_cooldown_seconds) then
    raise exception '[submit_cooldown] Please wait before submitting another attempt.';
  end if;

  v_eval := public.simulation_evaluate(v_config, p_parameters);

  if (v_eval ->> 'success')::boolean and v_config.winner_count < v_config.max_winners then
    v_winner_rank := v_config.winner_count + 1;
    update public.simulation_config set winner_count = winner_count + 1 where id = p_config_id;
  end if;

  insert into public.simulation_attempts
    (config_id, team_id, submitted_parameters, sub_scores, overall, success, winner_rank)
  values (
    p_config_id, p_team_id, p_parameters,
    v_eval -> 'sub_scores', (v_eval ->> 'overall')::numeric, (v_eval ->> 'success')::boolean, v_winner_rank
  )
  returning id into v_attempt_id;

  perform public.log_activity(
    v_config.event_edition_id, p_team_id, 'team', 'simulation_attempt_submitted',
    jsonb_build_object('config_id', p_config_id, 'attempt_id', v_attempt_id, 'success', v_eval ->> 'success')
  );

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'sub_scores', v_eval -> 'sub_scores',
    'overall', v_eval -> 'overall',
    'success', v_eval -> 'success',
    'winner_rank', v_winner_rank
  );
end;
$$;

comment on function public.submit_simulation_attempt(uuid, uuid, jsonb) is
  'SIM-06/07/08/10: unlimited attempts gated only by a submit cooldown '
  '(anti-spam floor, not an attempt cap) and the global timer. Hard stops '
  'at max_winners (configurable per config row, default/historical 2) via '
  'the unique partial index plus this row lock.';

-- ---------------------------------------------------------------------------
-- 4. admin_save_simulation_config() — new trailing parameter with a
--    default, so every existing caller (seed_simulation_config, in-flight
--    client code) keeps working unmodified; only a caller that explicitly
--    passes p_max_winners changes the cap.
--
-- Adding a parameter changes the function's signature, so `create or
-- replace` on the new 10-arg form does NOT replace the existing 9-arg
-- function — Postgres would keep both as overloads, and named-argument
-- RPC calls that omit p_max_winners would then be ambiguous between them.
-- Drop the old signature explicitly first. That also resets privileges to
-- Supabase's default grants (EXECUTE to anon/authenticated) per
-- docs/MIGRATIONS.md's grants gotcha, so the revoke/grant pair below is
-- re-applied to the new signature, not skipped.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_save_simulation_config(
  uuid, timestamptz, uuid, uuid, jsonb, jsonb, jsonb, int, int
);

create or replace function public.admin_save_simulation_config(
  p_config_id uuid,
  p_expected_updated_at timestamptz,
  p_event_edition_id uuid,
  p_round_id uuid,
  p_parameters jsonb,
  p_scoring jsonb,
  p_answer_key jsonb,
  p_global_timer_seconds int,
  p_submit_cooldown_seconds int,
  p_max_winners int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config_id uuid;
  v_actual_updated_at timestamptz;
  v_actual_max_winners int;
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
    select updated_at, max_winners into v_actual_updated_at, v_actual_max_winners
    from public.simulation_config where id = p_config_id;
    if v_actual_updated_at is null then
      raise exception '[not_found] Simulation config not found.';
    end if;
    if p_expected_updated_at is not null and v_actual_updated_at <> p_expected_updated_at then
      raise exception '[stale_edit] This config was edited by someone else — refresh and try again.';
    end if;

    update public.simulation_config set
      parameters = p_parameters, scoring = p_scoring, answer_key = p_answer_key,
      global_timer_seconds = p_global_timer_seconds, submit_cooldown_seconds = p_submit_cooldown_seconds,
      defaults_overall = v_defaults_overall, round_id = p_round_id,
      max_winners = coalesce(p_max_winners, v_actual_max_winners)
    where id = p_config_id;

    v_config_id := p_config_id;
  else
    insert into public.simulation_config (
      event_edition_id, round_id, parameters, scoring, answer_key,
      global_timer_seconds, submit_cooldown_seconds, defaults_overall, max_winners
    ) values (
      p_event_edition_id, p_round_id, p_parameters, p_scoring, p_answer_key,
      p_global_timer_seconds, p_submit_cooldown_seconds, v_defaults_overall,
      coalesce(p_max_winners, 2)
    )
    returning id into v_config_id;
  end if;

  return v_config_id;
end;
$$;

revoke all on function public.admin_save_simulation_config(
  uuid, timestamptz, uuid, uuid, jsonb, jsonb, jsonb, int, int, int
) from public, anon, authenticated;
grant execute on function public.admin_save_simulation_config(
  uuid, timestamptz, uuid, uuid, jsonb, jsonb, jsonb, int, int, int
) to service_role;

-- ---------------------------------------------------------------------------
-- 5. The live event's current simulation config: raise its cap to 4 now,
--    matching the 4 generated answer keys, so every correct submission
--    among the four keys can win instead of only the first two. Scoped to
--    configs that haven't started yet — never touches winner_count,
--    winner_rank, simulation_attempts, or simulation_rewards, so nothing
--    already recorded is affected.
-- ---------------------------------------------------------------------------

update public.simulation_config
set max_winners = 4
where started_at is null;

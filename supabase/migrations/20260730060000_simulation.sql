-- Migration 005 — On-spot weighted-priority simulation
-- 8 categorical parameters x 4 options + 4 sliders (0-100), an
-- admin-editable weighted rubric with graded partial credit (never a 0/1
-- match), tolerance-band slider matching, and a server-locked "first two
-- correct submissions win" race. The six sub-scores + overall are the
-- entire feedback channel; the return payload never leaks which of the
-- four keys a team is closest to.
--
-- PRD references: §13/13.1-13.4, SIM-01..11, SEC-07, §28.4 (AT-SIM-01..04).

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- simulation_config — one row, three trust-scoped jsonb columns.
-- No team select policy exists at all (see RLS below) — the public-safe
-- "parameters" reach a team only through simulation_status()'s curated
-- jsonb, never via `select *` on this table, so "scoring"/"answer_key"
-- can never leak through a forgotten column strip.
-- ---------------------------------------------------------------------------

create table public.simulation_config (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  round_id uuid references public.rounds (id) on delete set null,
  parameters jsonb not null,
  scoring jsonb not null,
  answer_key jsonb not null,
  global_timer_seconds int not null default 1500,
  submit_cooldown_seconds int not null default 3,
  started_at timestamptz,
  stopped_at timestamptz,
  winner_count int not null default 0,
  -- The database itself refuses a config that breaks calibration — the
  -- seed/save-time evaluator must land here at exactly 70 or the row
  -- cannot be written at all.
  defaults_overall numeric not null check (defaults_overall = 70),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.simulation_config is
  'SIM-04/05: the "combination universe" lives in parameters (public-safe) '
  'and scoring (private weights/partial-credit/tolerance); answer_key '
  '(the 4 fixed correct combinations, SIM-05) is service_role only and '
  'never served to a team. Generated at seed time, never committed to '
  'client code or repo seed data.';

create trigger set_updated_at
  before update on public.simulation_config
  for each row execute function public.set_updated_at();

alter table public.simulation_config enable row level security;

create policy "simulation_config_admin_all"
  on public.simulation_config for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- simulation_attempts — every submission logged regardless of outcome
-- (SIM-09), server_ts is the AT-SIM-03 ordering authority.
-- ---------------------------------------------------------------------------

create table public.simulation_attempts (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.simulation_config (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  submitted_parameters jsonb not null,
  sub_scores jsonb not null,
  overall numeric not null,
  success boolean not null default false,
  winner_rank int check (winner_rank in (1, 2)),
  server_ts timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default now()
);

comment on table public.simulation_attempts is
  'SIM-08: server_ts uses clock_timestamp() (not now(), which is frozen '
  'per-transaction) so ordering reflects true submission order even under '
  'concurrent transactions.';

-- SIM-07/AT-SIM-04: at most one row per (config, rank) — combined with the
-- row lock in submit_simulation_attempt(), this makes "exactly two
-- winners, ever" race-safe rather than merely likely.
create unique index simulation_attempts_winner_rank_unique
  on public.simulation_attempts (config_id, winner_rank)
  where winner_rank is not null;

create index simulation_attempts_config_team_ts_idx
  on public.simulation_attempts (config_id, team_id, server_ts desc);

alter table public.simulation_attempts enable row level security;

create policy "simulation_attempts_select_own_or_admin"
  on public.simulation_attempts for select
  to authenticated
  using (team_id = (select auth.uid()) or public.is_admin());

create policy "simulation_attempts_admin_write"
  on public.simulation_attempts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- simulation_rewards — SIM-11. Records the admin's decision, never a
-- balance (principle #4: purse stays an append-only ledger elsewhere).
-- A team gets marks OR purse, never both.
-- ---------------------------------------------------------------------------

create table public.simulation_rewards (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.simulation_config (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  attempt_id uuid references public.simulation_attempts (id) on delete set null,
  reward_kind text not null check (reward_kind in ('marks', 'purse')),
  amount numeric(14, 2) not null,
  target_round_id uuid references public.rounds (id) on delete set null,
  purse_applied_at timestamptz,
  -- No FK yet — migration 006 adds
  -- `references public.purse_ledger (id)` as a validating ADD CONSTRAINT,
  -- not a table rewrite.
  purse_ledger_entry_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  constraint simulation_rewards_config_team_unique unique (config_id, team_id)
);

comment on table public.simulation_rewards is
  'attempt_id is nullable for the §13.4 edge case: the timer expires with '
  'fewer than two winners and admin awards from any recorded correct '
  'submission, or from none.';

alter table public.simulation_rewards enable row level security;

create policy "simulation_rewards_admin_all"
  on public.simulation_rewards for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Phase 6's consumption contract — coded against this view, not the table,
-- so nothing here needs to change when migration 006 lands.
create view public.pending_simulation_purse_awards
with (security_invoker = true)
as
select
  r.id as simulation_reward_id,
  r.team_id,
  r.amount,
  c.event_edition_id,
  a.winner_rank
from public.simulation_rewards r
join public.simulation_config c on c.id = r.config_id
left join public.simulation_attempts a on a.id = r.attempt_id
where r.reward_kind = 'purse' and r.purse_applied_at is null;

-- ---------------------------------------------------------------------------
-- simulation_evaluate() — the rubric. Graded partial credit per categorical
-- parameter (never 0/1) plus tolerance-band slider matching turns every
-- sub-score into a distance signal instead of a step function. success is
-- never a score threshold — it is "every categorical exactly matches one
-- key AND every slider is inside that key's tolerance band" — which
-- decouples "which submissions win" (fixed forever) from "how hard the
-- rubric feels" (fully admin-tunable).
-- ---------------------------------------------------------------------------

create or replace function public.simulation_evaluate(p_config public.simulation_config, p_parameters jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_scoring jsonb := p_config.scoring;
  v_partial jsonb := v_scoring -> 'partial';
  v_sub_floor numeric := coalesce((v_scoring ->> 'sub_floor')::numeric, 20);
  v_sub_ceiling numeric := coalesce((v_scoring ->> 'sub_ceiling')::numeric, 100);
  v_offset numeric := coalesce((v_scoring ->> 'overall_offset')::numeric, 0);
  v_gain numeric := coalesce((v_scoring ->> 'overall_gain')::numeric, 1);
  v_rounding numeric := coalesce((v_scoring ->> 'sub_score_rounding')::numeric, 1);
  v_default_tolerance numeric := coalesce((v_scoring ->> 'slider_tolerance')::numeric, 10);
  v_default_falloff numeric := coalesce((v_scoring ->> 'slider_falloff')::numeric, 30);
  v_key jsonb;
  v_sub jsonb;
  v_input jsonb;
  v_param text;
  v_credit numeric;
  v_weighted_sum numeric;
  v_weight_total numeric;
  v_sub_value numeric;
  v_subs jsonb;
  v_overall numeric;
  v_weighted_overall numeric;
  v_overall_weight_total numeric;
  v_all_match boolean;
  v_chosen text;
  v_required text;
  v_target numeric;
  v_tolerance numeric;
  v_falloff numeric;
  v_best_overall numeric := -1;
  v_best_subs jsonb;
  v_best_success boolean := false;
  v_best_index int;
begin
  for v_key in select * from jsonb_array_elements(p_config.answer_key -> 'keys') loop
    v_subs := '{}'::jsonb;
    v_all_match := true;
    v_weighted_overall := 0;
    v_overall_weight_total := 0;

    for v_sub in select * from jsonb_array_elements(v_scoring -> 'sub_scores') loop
      v_weighted_sum := 0;
      v_weight_total := 0;

      for v_input in select * from jsonb_array_elements(v_sub -> 'inputs') loop
        v_param := v_input ->> 'param';

        if (v_key -> 'sliders') ? v_param then
          v_target := ((v_key -> 'sliders' -> v_param) ->> 'target')::numeric;
          v_tolerance := coalesce(((v_key -> 'sliders' -> v_param) ->> 'tolerance')::numeric, v_default_tolerance);
          v_falloff := v_default_falloff;
          v_credit := greatest(0, least(1,
            1 - greatest(0, abs((p_parameters -> 'sliders' ->> v_param)::numeric - v_target) - v_tolerance)
              / nullif(v_falloff, 0)
          ));
        else
          v_required := v_key -> 'categorical' ->> v_param;
          v_chosen := p_parameters -> 'categorical' ->> v_param;
          if v_chosen = v_required then
            v_credit := 1;
          else
            v_credit := coalesce((v_partial -> v_param -> v_required ->> v_chosen)::numeric, 0);
          end if;
        end if;

        v_weighted_sum := v_weighted_sum + v_credit * (v_input ->> 'weight')::numeric;
        v_weight_total := v_weight_total + (v_input ->> 'weight')::numeric;

        if v_credit < 1 then
          v_all_match := false;
        end if;
      end loop;

      v_sub_value := round(v_sub_floor + (v_sub_ceiling - v_sub_floor) * (v_weighted_sum / nullif(v_weight_total, 0)));
      v_sub_value := round(v_sub_value / v_rounding) * v_rounding;
      v_subs := v_subs || jsonb_build_object(v_sub ->> 'key', v_sub_value);

      v_weighted_overall := v_weighted_overall + v_sub_value * (v_sub ->> 'overall_weight')::numeric;
      v_overall_weight_total := v_overall_weight_total + (v_sub ->> 'overall_weight')::numeric;
    end loop;

    v_overall := round(least(100, greatest(0,
      (v_weighted_overall / nullif(v_overall_weight_total, 0)) * v_gain + v_offset
    )));

    -- success is never a score threshold — it is decoupled from the rubric
    -- entirely so an admin can retune difficulty without ever changing
    -- which submissions win (SIM-05).
    if v_all_match then
      v_overall := 100;
    end if;

    if v_overall > v_best_overall then
      v_best_overall := v_overall;
      v_best_subs := v_subs;
      v_best_success := v_all_match;
      v_best_index := (v_key ->> 'index')::int;
    end if;
  end loop;

  -- matched_key_index is returned here for admin_save_simulation_config's
  -- calibration check only; submit_simulation_attempt strips it before
  -- returning anything to a team.
  return jsonb_build_object(
    'sub_scores', v_best_subs,
    'overall', v_best_overall,
    'success', v_best_success,
    'matched_key_index', v_best_index
  );
end;
$$;

comment on function public.simulation_evaluate(public.simulation_config, jsonb) is
  'Evaluates against every key and returns the best (nearest-key) result — '
  'keeps hill-climbing coherent, since a team is always climbing toward '
  'some key. Which key is never revealed by any caller of this function.';

-- ---------------------------------------------------------------------------
-- simulation_status() — SIM-02/03/10, mirrors is_registration_open()'s
-- clock-function shape. The only public-safe read path to this
-- configuration; granted directly to authenticated (see grants) since it
-- has no per-team branching and leaks nothing private.
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
  elsif v_config.winner_count >= 2 then
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
    'winner_count', v_config.winner_count
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_simulation_attempt() — the row lock on simulation_config
-- serializes near-simultaneous correct submissions so the second sees the
-- first's winner_count increment before deciding its own winner_rank
-- (AT-SIM-03/04).
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
  if v_config.winner_count >= 2 then
    raise exception '[simulation_already_won] Two winners have already been confirmed.';
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

  if (v_eval ->> 'success')::boolean and v_config.winner_count < 2 then
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

  -- Never matched_key_index, never a per-parameter breakdown — that
  -- lossiness is the puzzle. Uses `->` (not `->>`) for overall/success so
  -- the jsonb keeps its real number/boolean type — `->>` would silently
  -- turn `false` into the *string* "false", which is truthy in JS.
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
  'at two winners via the unique partial index plus this row lock.';

-- ---------------------------------------------------------------------------
-- Admin config CRUD — calibration enforced at save time using the same
-- evaluator submit_simulation_attempt uses, so "70" is enforced, not hoped.
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

  return v_config_id;
end;
$$;

create or replace function public.admin_set_simulation_lifecycle(p_config_id uuid, p_action text)
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
      raise exception '[simulation_already_stopped] A stopped simulation cannot be restarted — create a new config.';
    end if;
    update public.simulation_config set started_at = now() where id = p_config_id and started_at is null;
  elsif p_action = 'stop' then
    update public.simulation_config set stopped_at = now() where id = p_config_id and stopped_at is null;
  else
    raise exception '[invalid_action] Unknown simulation lifecycle action.';
  end if;
end;
$$;

comment on function public.admin_set_simulation_lifecycle(uuid, text) is
  'SIM-02/10: admin manually starts (for all qualified teams at once, via '
  'a shared config row) and can force-stop early; the timer/winner-count '
  'stop conditions are otherwise a pure function of the clock.';

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

  -- Marks path lands in the same scores shape an admin fills by hand
  -- (source = 'simulation'); the purse path is left for Phase 6's
  -- pending_simulation_purse_awards consumer.
  if p_reward_kind = 'marks' then
    insert into public.scores (round_id, team_id, total, max_total, source, published, notes)
    values (p_target_round_id, p_team_id, p_amount, null, 'simulation', false, p_reason)
    on conflict (round_id, team_id)
      do update set total = excluded.total, notes = excluded.notes, updated_at = now()
      where public.scores.source = 'simulation';
  end if;

  return v_reward_id;
end;
$$;

comment on function public.admin_confirm_simulation_reward(uuid, uuid, uuid, text, numeric, uuid, text) is
  'SIM-11: unique (config_id, team_id) on simulation_rewards means a team '
  'receives marks OR purse, never both.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.submit_simulation_attempt(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_simulation_attempt(uuid, uuid, jsonb) to service_role;

revoke all on function public.admin_save_simulation_config(uuid, timestamptz, uuid, uuid, jsonb, jsonb, jsonb, int, int) from public, anon, authenticated;
grant execute on function public.admin_save_simulation_config(uuid, timestamptz, uuid, uuid, jsonb, jsonb, jsonb, int, int) to service_role;

revoke all on function public.admin_set_simulation_lifecycle(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_simulation_lifecycle(uuid, text) to service_role;

revoke all on function public.admin_confirm_simulation_reward(uuid, uuid, uuid, text, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_confirm_simulation_reward(uuid, uuid, uuid, text, numeric, uuid, text) to service_role;

-- simulation_status() is read-only, has no per-team branching and never
-- exposes scoring/answer_key — granted to authenticated directly for live
-- polling, the same documented-exception shape as can_team_submit.
revoke all on function public.simulation_status(uuid) from public, anon;
grant execute on function public.simulation_status(uuid) to authenticated;

-- simulation_evaluate() takes a simulation_config row argument, like
-- effective_round_status()/quiz_current_index() — not callable via
-- PostgREST, left at its default public-executable grant.

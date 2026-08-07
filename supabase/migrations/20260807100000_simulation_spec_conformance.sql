-- Migration — brings the on-spot simulation's data model into conformance
-- with the plan spec (.claude/plans/this-project-is-exclusively-starry-
-- shore.md), fixing two real defects along the way:
--
-- 1. Parameter names never matched the plan's verbatim spec — the deployed
--    config uses pitch_type/toss_call/aggression/etc. instead of
--    battingCore/powerplay/riskAppetite/etc.
-- 2. The answer key is committed in the repo (this migration's own
--    predecessor, 20260802010000, and scripts/seed-demo.cjs), which the
--    plan explicitly forbids ("generated at seed time and stored in
--    simulation_config — never in client code, never in the repo's
--    committed seed data"). Worse, two of the four committed keys
--    (index 0 and index 3) are byte-identical — scripts/seed-demo.cjs's
--    `keyCategoricalPicks = [1, 2, 3, 1]` reuses pick "1" for both — so
--    there were only ever 3 real "championship formulas", not 4.
--
-- Fix: three new functions. simulation_default_parameters() and
-- simulation_default_scoring() hold the (non-secret) parameter/scoring
-- shape — safe to commit, since knowing the *shape* reveals nothing about
-- which values win. simulation_generate_answer_key() generates the actual
-- keys at call time from extensions.gen_random_bytes() (pgcrypto,
-- installed since 20260729115900) — this function's OUTPUT is never
-- committed anywhere; only seed_simulation_config() calls it, and only at
-- seed time, writing straight into simulation_config.answer_key (a
-- service_role-only column with no team-facing read path at all).
--
-- Distinctness of the 4 keys is guaranteed by construction, not left to
-- chance (that pigeonhole gap is exactly what produced the duplicate
-- above): two categorical params are used as a discriminator pair drawn
-- from 3x3=9 non-default combinations, so 4 keys can never collide on
-- that pair alone. Every other categorical is drawn from its own
-- non-default options (defaults are NOT options[0] for 7 of the 8 params
-- here — unlike the old scheme, "the default is always first" is no
-- longer true, so this can't be gamed by trying every param's first
-- option). Every slider target sits far outside the all-defaults credit
-- band by construction. All of this is asserted before the function
-- returns, so a future regression fails loudly at seed time instead of
-- shipping a broken calibration silently, which is exactly what happened
-- last time.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Parameter shape — plan spec verbatim (8 categoricals x 4 options,
--    4 sliders). Safe to commit: this is the puzzle's shape, not its
--    solution.
-- ---------------------------------------------------------------------------

create or replace function public.simulation_default_parameters()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'categorical', jsonb_build_array(
      jsonb_build_object('key', 'battingCore', 'label', 'Batting Core', 'default', 'balanced', 'options', jsonb_build_array(
        jsonb_build_object('key', 'aggressive', 'label', 'Aggressive'),
        jsonb_build_object('key', 'balanced', 'label', 'Balanced'),
        jsonb_build_object('key', 'anchor_heavy', 'label', 'Anchor Heavy'),
        jsonb_build_object('key', 'finisher_heavy', 'label', 'Finisher Heavy'))),
      jsonb_build_object('key', 'powerplay', 'label', 'Powerplay', 'default', 'balanced', 'options', jsonb_build_array(
        jsonb_build_object('key', 'attack', 'label', 'Attack'),
        jsonb_build_object('key', 'defensive', 'label', 'Defensive'),
        jsonb_build_object('key', 'balanced', 'label', 'Balanced'),
        jsonb_build_object('key', 'flexible', 'label', 'Flexible'))),
      jsonb_build_object('key', 'middleOvers', 'label', 'Middle Overs', 'default', 'rotation', 'options', jsonb_build_array(
        jsonb_build_object('key', 'spin_control', 'label', 'Spin Control'),
        jsonb_build_object('key', 'rotation', 'label', 'Rotation'),
        jsonb_build_object('key', 'boundary_hunting', 'label', 'Boundary Hunting'),
        jsonb_build_object('key', 'mixed', 'label', 'Mixed'))),
      jsonb_build_object('key', 'deathOvers', 'label', 'Death Overs', 'default', 'mixed', 'options', jsonb_build_array(
        jsonb_build_object('key', 'yorkers', 'label', 'Yorkers'),
        jsonb_build_object('key', 'variations', 'label', 'Variations'),
        jsonb_build_object('key', 'pace_off', 'label', 'Pace Off'),
        jsonb_build_object('key', 'mixed', 'label', 'Mixed'))),
      jsonb_build_object('key', 'captainStyle', 'label', 'Captain Style', 'default', 'tactical', 'options', jsonb_build_array(
        jsonb_build_object('key', 'tactical', 'label', 'Tactical'),
        jsonb_build_object('key', 'aggressive', 'label', 'Aggressive'),
        jsonb_build_object('key', 'calm', 'label', 'Calm'),
        jsonb_build_object('key', 'analytical', 'label', 'Analytical'))),
      jsonb_build_object('key', 'bowlingAttack', 'label', 'Bowling Attack', 'default', 'balanced', 'options', jsonb_build_array(
        jsonb_build_object('key', 'pace_heavy', 'label', 'Pace Heavy'),
        jsonb_build_object('key', 'spin_heavy', 'label', 'Spin Heavy'),
        jsonb_build_object('key', 'balanced', 'label', 'Balanced'),
        jsonb_build_object('key', 'matchup_based', 'label', 'Matchup Based'))),
      jsonb_build_object('key', 'fielding', 'label', 'Fielding', 'default', 'mixed', 'options', jsonb_build_array(
        jsonb_build_object('key', 'athletic', 'label', 'Athletic'),
        jsonb_build_object('key', 'safe', 'label', 'Safe'),
        jsonb_build_object('key', 'specialist', 'label', 'Specialist'),
        jsonb_build_object('key', 'mixed', 'label', 'Mixed'))),
      jsonb_build_object('key', 'benchStrategy', 'label', 'Bench Strategy', 'default', 'balanced', 'options', jsonb_build_array(
        jsonb_build_object('key', 'experienced', 'label', 'Experienced'),
        jsonb_build_object('key', 'young', 'label', 'Young'),
        jsonb_build_object('key', 'matchup', 'label', 'Matchup'),
        jsonb_build_object('key', 'balanced', 'label', 'Balanced')))
    ),
    'sliders', jsonb_build_array(
      jsonb_build_object('key', 'riskAppetite', 'label', 'Risk Appetite', 'min', 0, 'max', 100, 'step', 1, 'default', 50),
      jsonb_build_object('key', 'dataAnalytics', 'label', 'Data Analytics', 'min', 0, 'max', 100, 'step', 1, 'default', 50),
      jsonb_build_object('key', 'fitnessPriority', 'label', 'Fitness Priority', 'min', 0, 'max', 100, 'step', 1, 'default', 50),
      jsonb_build_object('key', 'teamChemistry', 'label', 'Team Chemistry', 'min', 0, 'max', 100, 'step', 1, 'default', 50)
    )
  );
$$;

create or replace function public.simulation_default_scoring()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'sub_floor', 20, 'sub_ceiling', 100, 'overall_offset', 50, 'overall_gain', 1,
    'sub_score_rounding', 1, 'slider_tolerance', 10, 'slider_falloff', 30, 'partial', '{}'::jsonb,
    'sub_scores', jsonb_build_array(
      jsonb_build_object('key', 'batting', 'overall_weight', 1, 'inputs', jsonb_build_array(
        jsonb_build_object('param', 'battingCore', 'weight', 1), jsonb_build_object('param', 'powerplay', 'weight', 1))),
      jsonb_build_object('key', 'bowling', 'overall_weight', 1, 'inputs', jsonb_build_array(
        jsonb_build_object('param', 'bowlingAttack', 'weight', 1), jsonb_build_object('param', 'deathOvers', 'weight', 1))),
      jsonb_build_object('key', 'leadership', 'overall_weight', 1, 'inputs', jsonb_build_array(
        jsonb_build_object('param', 'captainStyle', 'weight', 1), jsonb_build_object('param', 'riskAppetite', 'weight', 1))),
      jsonb_build_object('key', 'fielding', 'overall_weight', 1, 'inputs', jsonb_build_array(
        jsonb_build_object('param', 'fielding', 'weight', 1), jsonb_build_object('param', 'fitnessPriority', 'weight', 1))),
      jsonb_build_object('key', 'bench', 'overall_weight', 1, 'inputs', jsonb_build_array(
        jsonb_build_object('param', 'benchStrategy', 'weight', 1), jsonb_build_object('param', 'middleOvers', 'weight', 1))),
      jsonb_build_object('key', 'chemistry', 'overall_weight', 1, 'inputs', jsonb_build_array(
        jsonb_build_object('param', 'teamChemistry', 'weight', 1), jsonb_build_object('param', 'dataAnalytics', 'weight', 1)))
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Key generator — the only place the actual answer ever exists, and it
--    is never written anywhere but simulation_config.answer_key.
-- ---------------------------------------------------------------------------

create or replace function public.simulation_generate_answer_key(p_parameters jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_categorical jsonb := p_parameters -> 'categorical';
  v_sliders jsonb := p_parameters -> 'sliders';
  v_pair_a_key text := v_categorical -> 0 ->> 'key';
  v_pair_b_key text := v_categorical -> 1 ->> 'key';
  v_pair_a_opts text[];
  v_pair_b_opts text[];
  v_pairs jsonb;
  v_keys jsonb := '[]'::jsonb;
  i int;
  j int;
  v_param jsonb;
  v_key_categorical jsonb;
  v_key_sliders jsonb;
  v_nd text[];
  v_pick text;
  v_target numeric;
  v_tolerance constant numeric := 5;
begin
  select array_agg(o ->> 'key') into v_pair_a_opts
  from jsonb_array_elements(v_categorical -> 0 -> 'options') o
  where o ->> 'key' <> (v_categorical -> 0 ->> 'default');

  select array_agg(o ->> 'key') into v_pair_b_opts
  from jsonb_array_elements(v_categorical -> 1 -> 'options') o
  where o ->> 'key' <> (v_categorical -> 1 ->> 'default');

  -- Pigeonhole: 4 keys drawn from a single param's 3 non-default options
  -- must repeat on that param (that's the exact bug being fixed). A pair
  -- of params gives 3x3=9 combinations, so 4 keys can be pairwise
  -- distinct on the pair alone, independent of every other draw below.
  select jsonb_agg(jsonb_build_object('a', a, 'b', b) order by random())
  into v_pairs
  from (
    select a, b from unnest(v_pair_a_opts) a cross join unnest(v_pair_b_opts) b
    order by random()
    limit 4
  ) combos;

  for i in 0..3 loop
    v_key_categorical := '{}'::jsonb;
    for j in 0..jsonb_array_length(v_categorical) - 1 loop
      v_param := v_categorical -> j;
      if v_param ->> 'key' = v_pair_a_key then
        v_pick := v_pairs -> i ->> 'a';
      elsif v_param ->> 'key' = v_pair_b_key then
        v_pick := v_pairs -> i ->> 'b';
      else
        select array_agg(o ->> 'key') into v_nd
        from jsonb_array_elements(v_param -> 'options') o
        where o ->> 'key' <> (v_param ->> 'default');
        v_pick := v_nd[1 + floor(random() * array_length(v_nd, 1))::int];
      end if;
      v_key_categorical := v_key_categorical || jsonb_build_object(v_param ->> 'key', v_pick);
    end loop;

    v_key_sliders := '{}'::jsonb;
    for j in 0..jsonb_array_length(v_sliders) - 1 loop
      v_param := v_sliders -> j;
      -- Coin-flip a high [88,97] or low [3,12] band so |default(50) -
      -- target| >= 38, comfortably outside tolerance(5) + falloff(30) =
      -- 35 — defaults credit is exactly 0 on every slider, every key.
      if random() < 0.5 then
        v_target := 88 + floor(random() * 10);
      else
        v_target := 3 + floor(random() * 10);
      end if;
      v_key_sliders := v_key_sliders
        || jsonb_build_object(v_param ->> 'key', jsonb_build_object('target', v_target, 'tolerance', v_tolerance));
    end loop;

    v_keys := v_keys || jsonb_build_array(jsonb_build_object('index', i, 'categorical', v_key_categorical, 'sliders', v_key_sliders));
  end loop;

  -- Belt-and-braces: assert what construction above should already
  -- guarantee, so a future edit to this function that breaks one of these
  -- invariants fails loudly at seed time instead of shipping a silently
  -- broken calibration (which is exactly what happened before this
  -- migration).
  if (select count(distinct (k - 'index')) from jsonb_array_elements(v_keys) k) <> 4 then
    raise exception '[key_generation_failed] the 4 answer keys are not pairwise distinct';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_keys) k, jsonb_array_elements(v_categorical) p
    where k -> 'categorical' ->> (p ->> 'key') = (p ->> 'default')
  ) then
    raise exception '[key_generation_failed] a generated key matches a categorical param''s default';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_keys) k,
         jsonb_array_elements(v_sliders) sp,
         lateral (select (k -> 'sliders' -> (sp ->> 'key') ->> 'target')::numeric as target) t
    where abs((sp ->> 'default')::numeric - t.target) <= 35
  ) then
    raise exception '[key_generation_failed] a generated slider target is inside the all-defaults credit band';
  end if;

  return jsonb_build_object('keys', v_keys);
end;
$$;

comment on function public.simulation_generate_answer_key(jsonb) is
  'The only place the simulation''s actual answer ever exists — output is '
  'never committed to the repo (unlike the answer key this migration '
  'replaces), only written into simulation_config.answer_key by '
  'seed_simulation_config() below.';

revoke all on function public.simulation_generate_answer_key(jsonb) from public, anon, authenticated;
grant execute on function public.simulation_generate_answer_key(jsonb) to service_role;

revoke all on function public.simulation_default_parameters() from public, anon, authenticated;
grant execute on function public.simulation_default_parameters() to service_role;
revoke all on function public.simulation_default_scoring() from public, anon, authenticated;
grant execute on function public.simulation_default_scoring() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Seeder — routes through admin_save_simulation_config() so the
--    "all-defaults must evaluate to exactly 70" calibration check applies
--    here exactly as it does to an admin's manual save; a broken
--    calibration fails the migration instead of shipping.
-- ---------------------------------------------------------------------------

create or replace function public.seed_simulation_config(p_event_edition_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parameters jsonb := public.simulation_default_parameters();
  v_scoring jsonb := public.simulation_default_scoring();
  v_answer_key jsonb := public.simulation_generate_answer_key(v_parameters);
begin
  -- round_id stays null: setting it switches on
  -- team_meets_stage_requirement() gating in submit_simulation_attempt(),
  -- which would require every demo/e2e team to first qualify for a stage
  -- before the simulation becomes submittable at all.
  return public.admin_save_simulation_config(
    null, null, p_event_edition_id, null, v_parameters, v_scoring, v_answer_key, 1500, 3
  );
end;
$$;

comment on function public.seed_simulation_config(uuid) is
  'Builds parameters/scoring/a freshly generated answer_key and inserts '
  'via admin_save_simulation_config() (not a raw INSERT) so calibration is '
  'verified, not hand-asserted. Called by scripts/seed-demo.cjs and by the '
  'do-block below for any edition still holding the old (pitch_type/'
  'aggression) placeholder shape.';

revoke all on function public.seed_simulation_config(uuid) from public, anon, authenticated;
grant execute on function public.seed_simulation_config(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Replace any config still on the old parameter names, for every
--    edition (not just the live one — the dedicated e2e-test edition,
--    src/lib/event-edition.ts, needs this too). Refuses to touch a config
--    with an already-applied simulation reward, since deleting a reward
--    row does not reverse its purse_ledger entry.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. Admin-initiated key regeneration — audited, and refuses once the
--    simulation has started (regenerating mid-round would invalidate any
--    already-confirmed winner's actual submitted combination).
-- ---------------------------------------------------------------------------

create or replace function public.admin_regenerate_simulation_answer_keys(
  p_config_id uuid,
  p_admin_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.simulation_config;
  v_new_key jsonb;
begin
  perform public.assert_admin(p_admin_id);
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '[reason_required] A reason is required to regenerate the answer key.';
  end if;

  select * into v_config from public.simulation_config where id = p_config_id for update;
  if v_config.id is null then
    raise exception '[not_found] Simulation config not found.';
  end if;
  if v_config.started_at is not null then
    raise exception '[simulation_already_started] Cannot regenerate keys once the simulation has started.';
  end if;

  v_new_key := public.simulation_generate_answer_key(v_config.parameters);
  update public.simulation_config set answer_key = v_new_key where id = p_config_id;

  perform public.log_activity(
    v_config.event_edition_id, null, 'admin', 'simulation_answer_keys_regenerated',
    jsonb_build_object('config_id', p_config_id, 'admin_id', p_admin_id, 'reason', p_reason)
  );
end;
$$;

revoke all on function public.admin_regenerate_simulation_answer_keys(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_regenerate_simulation_answer_keys(uuid, uuid, text) to service_role;

do $$
declare
  v_edition record;
  v_old_id uuid;
begin
  for v_edition in select id from public.event_editions loop
    select id into v_old_id
    from public.simulation_config
    where event_edition_id = v_edition.id
      and parameters -> 'categorical' -> 0 ->> 'key' = 'pitch_type';

    if v_old_id is not null then
      if exists (
        select 1 from public.simulation_rewards
        where config_id = v_old_id and purse_applied_at is not null
      ) then
        raise exception '[simulation_rewards_applied] Edition % has an applied simulation purse reward — reverse it before re-seeding.', v_edition.id;
      end if;

      delete from public.simulation_config where id = v_old_id; -- cascades attempts + rewards
    end if;

    if v_old_id is not null or not exists (
      select 1 from public.simulation_config where event_edition_id = v_edition.id
    ) then
      perform public.seed_simulation_config(v_edition.id);
    end if;
  end loop;
end;
$$;

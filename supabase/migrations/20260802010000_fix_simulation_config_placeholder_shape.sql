-- Migration — corrects the simulation_config placeholder shape seeded by
-- 20260801130000_seed_stages_and_simulation_config.sql.
--
-- That migration wrote parameters/scoring/answer_key directly via a raw
-- INSERT, bypassing admin_save_simulation_config() entirely — so the
-- placeholder was never actually validated against what that RPC (and
-- simulation_evaluate()) require. Two real shape mismatches resulted:
--
-- 1. parameters.categorical/sliders were plain objects (keyed by param
--    name), but src/app/app/simulation/simulation-console.tsx's frontend
--    type expects arrays of {key, label, default, options} /
--    {key, label, min, max, step, default} — confirmed live: visiting
--    /app/simulation as a team threw "parameters.categorical.map is not a
--    function" the moment a config existed.
-- 2. scoring/answer_key used field names (categorical_weight,
--    slider_weight, etc.) that simulation_evaluate() never reads at all —
--    it needs scoring.sub_scores (array of {key, inputs, overall_weight})
--    and answer_key.keys[] entries with an `index` plus nested
--    `categorical`/`sliders` objects (see admin_save_simulation_config()
--    and simulation_evaluate() in 20260730060000_simulation.sql). With the
--    old shape, simulation_evaluate() would have read nulls throughout and
--    never actually scored a submission correctly.
--
-- Both bugs were latent even during the "High confidence" TESTING_GUIDE #7
-- verification, which only exercised the visible_at reveal/hide toggle
-- directly against the database, never a real team submission end to end.
--
-- Fixed by replacing any existing placeholder row that still has the old
-- (object-keyed) shape with one built in the correct shape and inserted
-- through admin_save_simulation_config() itself — the same calibration
-- check ("all-defaults must evaluate to exactly 70") production goes
-- through, not a hand-asserted column value. Calibrates deterministically:
-- every categorical parameter's `default` is options[0], and every answer
-- key only ever uses options[1..3] for that parameter, so the all-defaults
-- probe never matches any key on any categorical input; every slider's
-- `default` (50) sits far outside every key's tolerance+falloff band
-- around its target (95, tolerance 5, falloff 30), so slider credit is 0
-- too. That makes every sub-score bottom out at sub_floor (20) for every
-- one of the 4 keys, so overall_offset: 50 (with overall_gain: 1) lands
-- exactly on 70 by construction. This exact JSON is mirrored in
-- scripts/seed-demo.cjs so a fresh deployment and a `seed:demo` run stay
-- identical.
--
-- Guarded so it never touches a row an admin has since edited through the
-- real /admin/simulation UI (admin_save_simulation_config always writes an
-- array-shaped parameters.categorical, so jsonb_typeof(...) = 'array' on
-- any admin-saved row, never 'object').

set search_path = public, extensions;

do $$
declare
  v_event_edition_id uuid;
  v_broken_id uuid;
  v_parameters jsonb;
  v_scoring jsonb;
  v_answer_key jsonb;
begin
  select id into v_event_edition_id from public.event_editions where slug = 'bidwave-2026';
  if v_event_edition_id is null then
    return;
  end if;

  select id into v_broken_id
  from public.simulation_config
  where event_edition_id = v_event_edition_id
    and jsonb_typeof(parameters -> 'categorical') = 'object';

  if v_broken_id is not null then
    delete from public.simulation_config where id = v_broken_id; -- cascades attempts/rewards (pre-event placeholder data only)
  end if;

  if v_broken_id is not null or not exists (
    select 1 from public.simulation_config where event_edition_id = v_event_edition_id
  ) then
    v_parameters := jsonb_build_object(
      'categorical', jsonb_build_array(
        jsonb_build_object('key', 'pitch_type', 'label', 'Pitch Type', 'default', 'green', 'options',
          jsonb_build_array(
            jsonb_build_object('key', 'green', 'label', 'Green'), jsonb_build_object('key', 'dry', 'label', 'Dry'),
            jsonb_build_object('key', 'flat', 'label', 'Flat'), jsonb_build_object('key', 'dusty', 'label', 'Dusty'))),
        jsonb_build_object('key', 'toss_call', 'label', 'Toss Call', 'default', 'bat', 'options',
          jsonb_build_array(
            jsonb_build_object('key', 'bat', 'label', 'Bat'), jsonb_build_object('key', 'bowl', 'label', 'Bowl'),
            jsonb_build_object('key', 'spin_first', 'label', 'Spin First'), jsonb_build_object('key', 'pace_first', 'label', 'Pace First'))),
        jsonb_build_object('key', 'field_setting', 'label', 'Field Setting', 'default', 'attacking', 'options',
          jsonb_build_array(
            jsonb_build_object('key', 'attacking', 'label', 'Attacking'), jsonb_build_object('key', 'balanced', 'label', 'Balanced'),
            jsonb_build_object('key', 'defensive', 'label', 'Defensive'), jsonb_build_object('key', 'spread', 'label', 'Spread'))),
        jsonb_build_object('key', 'batting_order', 'label', 'Batting Order', 'default', 'top_heavy', 'options',
          jsonb_build_array(
            jsonb_build_object('key', 'top_heavy', 'label', 'Top Heavy'), jsonb_build_object('key', 'balanced', 'label', 'Balanced'),
            jsonb_build_object('key', 'floaters', 'label', 'Floaters'), jsonb_build_object('key', 'power_hitters_early', 'label', 'Power Hitters Early'))),
        jsonb_build_object('key', 'bowling_plan', 'label', 'Bowling Plan', 'default', 'pace_heavy', 'options',
          jsonb_build_array(
            jsonb_build_object('key', 'pace_heavy', 'label', 'Pace Heavy'), jsonb_build_object('key', 'spin_heavy', 'label', 'Spin Heavy'),
            jsonb_build_object('key', 'mixed', 'label', 'Mixed'), jsonb_build_object('key', 'death_specialists', 'label', 'Death Specialists'))),
        jsonb_build_object('key', 'powerplay_approach', 'label', 'Powerplay Approach', 'default', 'aggressive', 'options',
          jsonb_build_array(
            jsonb_build_object('key', 'aggressive', 'label', 'Aggressive'), jsonb_build_object('key', 'conservative', 'label', 'Conservative'),
            jsonb_build_object('key', 'wicket_preservation', 'label', 'Wicket Preservation'), jsonb_build_object('key', 'boundary_hunting', 'label', 'Boundary Hunting'))),
        jsonb_build_object('key', 'middle_overs_plan', 'label', 'Middle Overs Plan', 'default', 'rotate_strike', 'options',
          jsonb_build_array(
            jsonb_build_object('key', 'rotate_strike', 'label', 'Rotate Strike'), jsonb_build_object('key', 'build_partnership', 'label', 'Build Partnership'),
            jsonb_build_object('key', 'attack_spin', 'label', 'Attack Spin'), jsonb_build_object('key', 'consolidate', 'label', 'Consolidate'))),
        jsonb_build_object('key', 'death_overs_plan', 'label', 'Death Overs Plan', 'default', 'yorkers', 'options',
          jsonb_build_array(
            jsonb_build_object('key', 'yorkers', 'label', 'Yorkers'), jsonb_build_object('key', 'slower_balls', 'label', 'Slower Balls'),
            jsonb_build_object('key', 'bouncers', 'label', 'Bouncers'), jsonb_build_object('key', 'wide_yorkers', 'label', 'Wide Yorkers')))
      ),
      'sliders', jsonb_build_array(
        jsonb_build_object('key', 'aggression', 'label', 'Aggression', 'min', 0, 'max', 100, 'step', 1, 'default', 50),
        jsonb_build_object('key', 'risk_tolerance', 'label', 'Risk Tolerance', 'min', 0, 'max', 100, 'step', 1, 'default', 50),
        jsonb_build_object('key', 'boundary_focus', 'label', 'Boundary Focus', 'min', 0, 'max', 100, 'step', 1, 'default', 50),
        jsonb_build_object('key', 'rotation_focus', 'label', 'Rotation Focus', 'min', 0, 'max', 100, 'step', 1, 'default', 50)
      )
    );

    v_scoring := jsonb_build_object(
      'sub_floor', 20, 'sub_ceiling', 100, 'overall_offset', 50, 'overall_gain', 1,
      'sub_score_rounding', 1, 'slider_tolerance', 10, 'slider_falloff', 30, 'partial', '{}'::jsonb,
      'sub_scores', jsonb_build_array(
        jsonb_build_object('key', 'batting', 'overall_weight', 1, 'inputs', jsonb_build_array(
          jsonb_build_object('param', 'pitch_type', 'weight', 1), jsonb_build_object('param', 'batting_order', 'weight', 1))),
        jsonb_build_object('key', 'bowling', 'overall_weight', 1, 'inputs', jsonb_build_array(
          jsonb_build_object('param', 'bowling_plan', 'weight', 1), jsonb_build_object('param', 'death_overs_plan', 'weight', 1))),
        jsonb_build_object('key', 'leadership', 'overall_weight', 1, 'inputs', jsonb_build_array(
          jsonb_build_object('param', 'toss_call', 'weight', 1), jsonb_build_object('param', 'powerplay_approach', 'weight', 1))),
        jsonb_build_object('key', 'fielding', 'overall_weight', 1, 'inputs', jsonb_build_array(
          jsonb_build_object('param', 'field_setting', 'weight', 1), jsonb_build_object('param', 'middle_overs_plan', 'weight', 1))),
        jsonb_build_object('key', 'bench', 'overall_weight', 1, 'inputs', jsonb_build_array(
          jsonb_build_object('param', 'aggression', 'weight', 1), jsonb_build_object('param', 'boundary_focus', 'weight', 1))),
        jsonb_build_object('key', 'chemistry', 'overall_weight', 1, 'inputs', jsonb_build_array(
          jsonb_build_object('param', 'risk_tolerance', 'weight', 1), jsonb_build_object('param', 'rotation_focus', 'weight', 1)))
      )
    );

    -- 4 answer keys ("championship formulas", SIM-05), cycling through
    -- options[1..3] per categorical so the default (options[0]) never
    -- matches any key — see the calibration comment above.
    v_answer_key := jsonb_build_object('keys', jsonb_build_array(
      jsonb_build_object('index', 0,
        'categorical', jsonb_build_object(
          'pitch_type', 'dry', 'toss_call', 'bowl', 'field_setting', 'balanced', 'batting_order', 'balanced',
          'bowling_plan', 'spin_heavy', 'powerplay_approach', 'conservative', 'middle_overs_plan', 'build_partnership', 'death_overs_plan', 'slower_balls'),
        'sliders', jsonb_build_object(
          'aggression', jsonb_build_object('target', 95, 'tolerance', 5), 'risk_tolerance', jsonb_build_object('target', 95, 'tolerance', 5),
          'boundary_focus', jsonb_build_object('target', 95, 'tolerance', 5), 'rotation_focus', jsonb_build_object('target', 95, 'tolerance', 5))),
      jsonb_build_object('index', 1,
        'categorical', jsonb_build_object(
          'pitch_type', 'flat', 'toss_call', 'spin_first', 'field_setting', 'defensive', 'batting_order', 'floaters',
          'bowling_plan', 'mixed', 'powerplay_approach', 'wicket_preservation', 'middle_overs_plan', 'attack_spin', 'death_overs_plan', 'bouncers'),
        'sliders', jsonb_build_object(
          'aggression', jsonb_build_object('target', 95, 'tolerance', 5), 'risk_tolerance', jsonb_build_object('target', 95, 'tolerance', 5),
          'boundary_focus', jsonb_build_object('target', 95, 'tolerance', 5), 'rotation_focus', jsonb_build_object('target', 95, 'tolerance', 5))),
      jsonb_build_object('index', 2,
        'categorical', jsonb_build_object(
          'pitch_type', 'dusty', 'toss_call', 'pace_first', 'field_setting', 'spread', 'batting_order', 'power_hitters_early',
          'bowling_plan', 'death_specialists', 'powerplay_approach', 'boundary_hunting', 'middle_overs_plan', 'consolidate', 'death_overs_plan', 'wide_yorkers'),
        'sliders', jsonb_build_object(
          'aggression', jsonb_build_object('target', 95, 'tolerance', 5), 'risk_tolerance', jsonb_build_object('target', 95, 'tolerance', 5),
          'boundary_focus', jsonb_build_object('target', 95, 'tolerance', 5), 'rotation_focus', jsonb_build_object('target', 95, 'tolerance', 5))),
      jsonb_build_object('index', 3,
        'categorical', jsonb_build_object(
          'pitch_type', 'dry', 'toss_call', 'bowl', 'field_setting', 'balanced', 'batting_order', 'balanced',
          'bowling_plan', 'spin_heavy', 'powerplay_approach', 'conservative', 'middle_overs_plan', 'build_partnership', 'death_overs_plan', 'slower_balls'),
        'sliders', jsonb_build_object(
          'aggression', jsonb_build_object('target', 95, 'tolerance', 5), 'risk_tolerance', jsonb_build_object('target', 95, 'tolerance', 5),
          'boundary_focus', jsonb_build_object('target', 95, 'tolerance', 5), 'rotation_focus', jsonb_build_object('target', 95, 'tolerance', 5)))
    ));

    perform public.admin_save_simulation_config(
      null, null, v_event_edition_id, null, v_parameters, v_scoring, v_answer_key, 1500, 3
    );
  end if;
end;
$$;

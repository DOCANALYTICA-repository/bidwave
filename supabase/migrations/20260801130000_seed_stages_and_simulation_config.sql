-- Migration — Seed stages, stage_rounds and a placeholder simulation_config
-- (audit high-priority #19: "no migration seeds stages/stage_rounds, no
-- simulation configuration — a fresh deployment is not reproducible from
-- the repository alone").
--
-- Stage structure mirrors the progressive-elimination shape the PRD
-- describes and that admin_confirm_qualifications/can_team_submit already
-- assume: r1_r2 aggregates rounds 1+2 and its decision gates rounds 3+4;
-- r3_r4 aggregates rounds 3+4 and its decision gates the auction + round 6;
-- r6 aggregates round 6 alone; final is deliberately left with NO
-- stage_rounds — R6-04 (see admin/stages/stage-panel.tsx's own comment)
-- keeps the final top-10 a manually curated admin_publish_leaderboard()
-- call, never a computed aggregate. All of this is admin-editable via
-- /admin/stages and /admin/rounds after seeding — this migration only
-- guarantees a fresh deployment starts from a sane default instead of an
-- empty, non-functional one.
--
-- The on-spot simulation is intentionally NOT one of the six brochure
-- rounds (see CLAUDE.md: listed separately from "six competition rounds")
-- and has no entry in src/lib/rounds-catalog.ts's ROUND_COPY — so this
-- migration does not invent a rounds row for it, which would either 404 on
-- /rounds/[slug] or require fabricating brochure copy that was never
-- approved. simulation_config.round_id stays null, matching every other
-- RPC's "absent round_id means no stage gate" convention (audit P0 #2's
-- team_meets_stage_requirement already treats null round_id as ungated).

set search_path = public, extensions;

insert into public.stages (event_edition_id, code, label)
select e.id, v.code, v.label
from public.event_editions e
cross join (
  values
    ('r1_r2', 'Rounds 1 + 2'),
    ('r3_r4', 'Rounds 3 + 4'),
    ('r6', 'Round 6'),
    ('final', 'Final')
) as v(code, label)
where e.slug = 'bidwave-2026'
on conflict (event_edition_id, code) do nothing;

-- r1_r2 aggregates rounds 1 (quiz) + 2 (operation-fan-heist).
insert into public.stage_rounds (stage_id, round_id, weight)
select s.id, r.id, 1
from public.stages s
join public.event_editions e on e.id = s.event_edition_id and e.slug = 'bidwave-2026'
join public.rounds r on r.event_edition_id = e.id and r.slug in ('the-stat-sprint', 'operation-fan-heist')
where s.code = 'r1_r2'
on conflict (stage_id, round_id) do nothing;

-- r3_r4 aggregates rounds 3 (the-immersive-challenge) + 4 (crisis-room).
insert into public.stage_rounds (stage_id, round_id, weight)
select s.id, r.id, 1
from public.stages s
join public.event_editions e on e.id = s.event_edition_id and e.slug = 'bidwave-2026'
join public.rounds r on r.event_edition_id = e.id and r.slug in ('the-immersive-challenge', 'crisis-room')
where s.code = 'r3_r4'
on conflict (stage_id, round_id) do nothing;

-- r6 aggregates round 6 (the-owners-summit) alone.
insert into public.stage_rounds (stage_id, round_id, weight)
select s.id, r.id, 1
from public.stages s
join public.event_editions e on e.id = s.event_edition_id and e.slug = 'bidwave-2026'
join public.rounds r on r.event_edition_id = e.id and r.slug = 'the-owners-summit'
where s.code = 'r6'
on conflict (stage_id, round_id) do nothing;

-- Rounds 3+4 require r1_r2 qualification; the auction + round 6 require
-- r3_r4 qualification. Only set when not already configured, so an admin
-- who has already adjusted this via /admin/rounds is never overridden.
update public.rounds r
set requires_qualification_from_stage = s.id
from public.stages s
join public.event_editions e on e.id = s.event_edition_id
where e.slug = 'bidwave-2026'
  and s.code = 'r1_r2'
  and r.event_edition_id = e.id
  and r.slug in ('the-immersive-challenge', 'crisis-room')
  and r.requires_qualification_from_stage is null;

update public.rounds r
set requires_qualification_from_stage = s.id
from public.stages s
join public.event_editions e on e.id = s.event_edition_id
where e.slug = 'bidwave-2026'
  and s.code = 'r3_r4'
  and r.event_edition_id = e.id
  and r.slug in ('the-grand-auction', 'the-owners-summit')
  and r.requires_qualification_from_stage is null;

-- Placeholder simulation_config — DEP-05's real parameter/scoring/answer-key
-- values are still pending from the client (same "clearly-placeholder"
-- convention as auction_rule_sets' defaults), but a fresh deployment needs
-- a row to exist at all before /admin/simulation has anything to edit.
-- defaults_overall must land at exactly 70 (the calibration CHECK) — this
-- placeholder parameter/scoring/answer_key set is hand-verified to do so.
insert into public.simulation_config (
  event_edition_id, round_id, parameters, scoring, answer_key,
  global_timer_seconds, submit_cooldown_seconds, defaults_overall
)
select
  e.id, null,
  '{
    "categorical": {
      "pitch_type": ["green", "dry", "flat", "dusty"],
      "toss_call": ["bat", "bowl", "spin_first", "pace_first"],
      "field_setting": ["attacking", "balanced", "defensive", "spread"],
      "batting_order": ["top_heavy", "balanced", "floaters", "power_hitters_early"],
      "bowling_plan": ["pace_heavy", "spin_heavy", "mixed", "death_specialists"],
      "powerplay_approach": ["aggressive", "conservative", "wicket_preservation", "boundary_hunting"],
      "middle_overs_plan": ["rotate_strike", "build_partnership", "attack_spin", "consolidate"],
      "death_overs_plan": ["yorkers", "slower_balls", "bouncers", "wide_yorkers"]
    },
    "sliders": {
      "aggression": {"min": 0, "max": 100},
      "risk_tolerance": {"min": 0, "max": 100},
      "boundary_focus": {"min": 0, "max": 100},
      "rotation_focus": {"min": 0, "max": 100}
    }
  }'::jsonb,
  '{
    "categorical_weight": 60,
    "slider_weight": 40,
    "per_categorical_key_weight": 7.5,
    "slider_tolerance_band": 10
  }'::jsonb,
  '{
    "keys": [
      {
        "pitch_type": "green", "toss_call": "bowl", "field_setting": "attacking",
        "batting_order": "top_heavy", "bowling_plan": "pace_heavy",
        "powerplay_approach": "aggressive", "middle_overs_plan": "attack_spin",
        "death_overs_plan": "yorkers",
        "sliders": {"aggression": 70, "risk_tolerance": 60, "boundary_focus": 65, "rotation_focus": 40}
      },
      {
        "pitch_type": "dusty", "toss_call": "bat", "field_setting": "defensive",
        "batting_order": "balanced", "bowling_plan": "spin_heavy",
        "powerplay_approach": "conservative", "middle_overs_plan": "consolidate",
        "death_overs_plan": "slower_balls",
        "sliders": {"aggression": 40, "risk_tolerance": 35, "boundary_focus": 45, "rotation_focus": 65}
      },
      {
        "pitch_type": "flat", "toss_call": "bat", "field_setting": "balanced",
        "batting_order": "power_hitters_early", "bowling_plan": "mixed",
        "powerplay_approach": "boundary_hunting", "middle_overs_plan": "rotate_strike",
        "death_overs_plan": "bouncers",
        "sliders": {"aggression": 60, "risk_tolerance": 55, "boundary_focus": 70, "rotation_focus": 50}
      },
      {
        "pitch_type": "dry", "toss_call": "spin_first", "field_setting": "spread",
        "batting_order": "floaters", "bowling_plan": "death_specialists",
        "powerplay_approach": "wicket_preservation", "middle_overs_plan": "build_partnership",
        "death_overs_plan": "wide_yorkers",
        "sliders": {"aggression": 50, "risk_tolerance": 45, "boundary_focus": 55, "rotation_focus": 60}
      }
    ]
  }'::jsonb,
  1500, 3, 70
from public.event_editions e
where e.slug = 'bidwave-2026'
  and not exists (select 1 from public.simulation_config sc where sc.event_edition_id = e.id);

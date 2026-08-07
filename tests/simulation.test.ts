import { describe, expect, it } from "vitest";
import { withTx, getActiveEventEditionId, createTestTeam, expectRejection } from "./helpers/db";

const PARAMETERS = {
  version: 1,
  categorical: [
    {
      key: "battingCore",
      order: 1,
      label: "Batting Core",
      default: "balanced",
      options: [
        { key: "aggressive", label: "Aggressive" },
        { key: "balanced", label: "Balanced" },
        { key: "anchor_heavy", label: "Anchor Heavy" },
        { key: "finisher_heavy", label: "Finisher Heavy" },
      ],
    },
  ],
  sliders: [{ key: "riskAppetite", order: 9, label: "Risk Appetite", min: 0, max: 100, step: 5, default: 50 }],
};

const SCORING = {
  version: 1,
  sub_scores: [
    {
      key: "batting",
      label: "BATTING",
      overall_weight: 1.0,
      inputs: [
        { param: "battingCore", weight: 3 },
        { param: "riskAppetite", weight: 1 },
      ],
    },
  ],
  partial: {
    battingCore: {
      aggressive: { balanced: 0.55, anchor_heavy: 0.15, finisher_heavy: 0.6 },
      balanced: { aggressive: 0.55, anchor_heavy: 0.6, finisher_heavy: 0.55 },
      anchor_heavy: { aggressive: 0.15, balanced: 0.6, finisher_heavy: 0.2 },
      finisher_heavy: { aggressive: 0.6, balanced: 0.55, anchor_heavy: 0.2 },
    },
  },
  sub_floor: 20,
  sub_ceiling: 100,
  slider_tolerance: 10,
  slider_falloff: 30,
  // Hand-calibrated for this specific fixture (one sub-score, inputs
  // battingCore x3 + riskAppetite x1) so all-defaults lands on exactly 70 —
  // the same calibration step admin_save_simulation_config performs for
  // real configs, done by hand here since this is a minimal test fixture.
  overall_offset: -3,
  overall_gain: 1,
  sub_score_rounding: 1,
};

const ANSWER_KEY = {
  version: 1,
  keys: [
    {
      index: 1,
      categorical: { battingCore: "anchor_heavy" },
      sliders: { riskAppetite: { target: 65, tolerance: 10 } },
    },
  ],
};

const CORRECT_PARAMS = { categorical: { battingCore: "anchor_heavy" }, sliders: { riskAppetite: 65 } };

async function createTestSimulationConfig(client: import("pg").Client, eventEditionId: string) {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.simulation_config
       (event_edition_id, parameters, scoring, answer_key, global_timer_seconds, submit_cooldown_seconds,
        started_at, defaults_overall)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, 1500, 0, now(), 70)
     returning id`,
    [eventEditionId, JSON.stringify(PARAMETERS), JSON.stringify(SCORING), JSON.stringify(ANSWER_KEY)],
  );
  return rows[0]!.id;
}

describe("AT-SIM-03/04: exactly two winners, ordered by server submission", () => {
  it("assigns rank 1 and rank 2 to the first two correct submissions and rejects a third", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const configId = await createTestSimulationConfig(client, editionId);

      const teamA = await createTestTeam(client, { name: `SIM-03 A ${Date.now()}`, eventEditionId: editionId });
      const teamB = await createTestTeam(client, { name: `SIM-03 B ${Date.now()}`, eventEditionId: editionId });
      const teamC = await createTestTeam(client, { name: `SIM-03 C ${Date.now()}`, eventEditionId: editionId });

      const first = await client.query(`select public.submit_simulation_attempt($1, $2, $3::jsonb) as result`, [
        teamA,
        configId,
        JSON.stringify(CORRECT_PARAMS),
      ]);
      const second = await client.query(`select public.submit_simulation_attempt($1, $2, $3::jsonb) as result`, [
        teamB,
        configId,
        JSON.stringify(CORRECT_PARAMS),
      ]);

      expect(first.rows[0].result.success).toBe(true);
      expect(Number(first.rows[0].result.winner_rank)).toBe(1);
      expect(second.rows[0].result.success).toBe(true);
      expect(Number(second.rows[0].result.winner_rank)).toBe(2);

      const rejection = await expectRejection(
        client,
        `select public.submit_simulation_attempt($1, $2, $3::jsonb) as result`,
        [teamC, configId, JSON.stringify(CORRECT_PARAMS)],
      );
      expect(rejection.message).toMatch(/simulation_already_won/);

      const { rows: winnerCount } = await client.query(
        `select winner_count from public.simulation_config where id = $1`,
        [configId],
      );
      expect(winnerCount[0].winner_count).toBe(2);
    });
  });

  it("never returns matched_key_index or a per-parameter breakdown to the caller", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const configId = await createTestSimulationConfig(client, editionId);
      const teamA = await createTestTeam(client, { name: `SIM-leak ${Date.now()}`, eventEditionId: editionId });

      const { rows } = await client.query(`select public.submit_simulation_attempt($1, $2, $3::jsonb) as result`, [
        teamA,
        configId,
        JSON.stringify({ categorical: { battingCore: "balanced" }, sliders: { riskAppetite: 50 } }),
      ]);

      const keys = Object.keys(rows[0].result);
      expect(keys).not.toContain("matched_key_index");
      expect(Number(rows[0].result.overall)).toBe(70); // all-defaults calibration
    });
  });
});

describe("calibration: all-defaults evaluates to exactly 70", () => {
  it("simulation_config rejects a row whose defaults_overall isn't 70", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const rejection = await expectRejection(
        client,
        `insert into public.simulation_config
           (event_edition_id, parameters, scoring, answer_key, defaults_overall)
         values ($1, $2::jsonb, $3::jsonb, $4::jsonb, 65)`,
        [editionId, JSON.stringify(PARAMETERS), JSON.stringify(SCORING), JSON.stringify(ANSWER_KEY)],
      );
      expect(rejection.message).toMatch(/simulation_config_defaults_overall_check/);
    });
  });
});

// 20260807100000 — plan conformance: parameter names moved to the plan's
// verbatim spec, and the answer key is generated at seed time instead of
// being committed in the repo (the committed version also had a real bug:
// keys 0 and 3 were byte-identical, so there were only 3 real "champion-
// ship formulas" despite the UI claiming four — scripts/seed-demo.cjs's
// `keyCategoricalPicks = [1, 2, 3, 1]`).
describe("seed_simulation_config: plan-conformant parameters and generated keys", () => {
  const PLAN_CATEGORICAL_KEYS = [
    "battingCore", "powerplay", "middleOvers", "deathOvers",
    "captainStyle", "bowlingAttack", "fielding", "benchStrategy",
  ];
  const PLAN_SLIDER_KEYS = ["riskAppetite", "dataAnalytics", "fitnessPriority", "teamChemistry"];

  it("seeds parameters with the plan's verbatim keys and calibrates to exactly 70", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const { rows } = await client.query(
        "select public.seed_simulation_config($1) as id",
        [editionId],
      );
      const { rows: configRows } = await client.query(
        "select parameters, defaults_overall from public.simulation_config where id = $1",
        [rows[0].id],
      );
      const { parameters, defaults_overall: defaultsOverall } = configRows[0];

      expect(parameters.categorical.map((c: { key: string }) => c.key)).toEqual(PLAN_CATEGORICAL_KEYS);
      for (const cat of parameters.categorical) {
        expect(cat.options).toHaveLength(4);
      }
      expect(parameters.sliders.map((s: { key: string }) => s.key)).toEqual(PLAN_SLIDER_KEYS);
      for (const slider of parameters.sliders) {
        expect(slider).toMatchObject({ min: 0, max: 100, step: 1, default: 50 });
      }
      expect(Number(defaultsOverall)).toBe(70);
    });
  });

  it("generates 4 pairwise-distinct keys, none matching a param default, every slider target outside the credit band", async () => {
    await withTx(async (client) => {
      const { rows: paramRows } = await client.query("select public.simulation_default_parameters() as p");
      const parameters = paramRows[0].p;
      const { rows: keyRows } = await client.query(
        "select public.simulation_generate_answer_key($1::jsonb) as k",
        [JSON.stringify(parameters)],
      );
      const keys = keyRows[0].k.keys;
      expect(keys).toHaveLength(4);

      const signatures = new Set(keys.map((k: { categorical: unknown; sliders: unknown }) =>
        JSON.stringify({ categorical: k.categorical, sliders: k.sliders }),
      ));
      expect(signatures.size).toBe(4);

      for (const cat of parameters.categorical) {
        for (const key of keys) {
          expect(key.categorical[cat.key]).not.toBe(cat.default);
        }
      }
      for (const slider of parameters.sliders) {
        for (const key of keys) {
          const target = key.sliders[slider.key].target;
          expect(Math.abs(slider.default - target)).toBeGreaterThan(35);
        }
      }
    });
  });

  it("generates a different answer key on each call (not derived from anything committed)", async () => {
    await withTx(async (client) => {
      const { rows: paramRows } = await client.query("select public.simulation_default_parameters() as p");
      const parameters = JSON.stringify(paramRows[0].p);
      const { rows: firstRows } = await client.query(
        "select public.simulation_generate_answer_key($1::jsonb) as k",
        [parameters],
      );
      const { rows: secondRows } = await client.query(
        "select public.simulation_generate_answer_key($1::jsonb) as k",
        [parameters],
      );
      expect(JSON.stringify(firstRows[0].k)).not.toBe(JSON.stringify(secondRows[0].k));
    });
  });

  it("submitting all-defaults through submit_simulation_attempt on the seeded config scores exactly 70 with no key leak", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `Seeded Sim Team ${Date.now()}`, eventEditionId: editionId });

      const { rows: seedRows } = await client.query(
        "select public.seed_simulation_config($1) as id",
        [editionId],
      );
      const configId = seedRows[0].id;
      await client.query("update public.simulation_config set started_at = now() where id = $1", [configId]);
      const { rows: configRows } = await client.query(
        "select parameters from public.simulation_config where id = $1",
        [configId],
      );
      const { parameters } = configRows[0];

      const defaultsParams = {
        categorical: Object.fromEntries(parameters.categorical.map((c: { key: string; default: string }) => [c.key, c.default])),
        sliders: Object.fromEntries(parameters.sliders.map((s: { key: string; default: number }) => [s.key, s.default])),
      };

      const { rows } = await client.query(
        "select public.submit_simulation_attempt($1, $2, $3::jsonb) as result",
        [teamId, configId, JSON.stringify(defaultsParams)],
      );
      const result = rows[0].result;
      expect(Number(result.overall)).toBe(70);
      expect(result.success).toBe(false);
      expect(result).not.toHaveProperty("matched_key_index");
    });
  });
});

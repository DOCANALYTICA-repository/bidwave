import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  withTx,
  getActiveEventEditionId,
  createTestTeam,
  createTestPlayer,
  createTestAuctionRuleSet,
  grantTestPurse,
  createTestAnalyticsRequest,
  createTestAdmin,
  expectRejection,
  asRole,
} from "./helpers/db";

// Audit P0 #1 — players_select_all used to grant full-row select (incl.
// stats) to anon/authenticated regardless of analytics purchase status.
describe("Audit P0 #1: players stats privacy", () => {
  it("anon can read players_public but not players directly", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Privacy Test Player" });
      await client.query("update public.players set stats = $2 where id = $1", [
        player.id,
        JSON.stringify({ strike_rate: 150 }),
      ]);

      await asRole(client, "anon");

      const { rows: publicRows } = await client.query(
        "select * from public.players_public where id = $1",
        [player.id],
      );
      expect(publicRows).toHaveLength(1);
      expect(publicRows[0].stats).toBeUndefined();

      const { rows: baseRows } = await client.query("select * from public.players where id = $1", [player.id]);
      expect(baseRows).toHaveLength(0);
    });
  });

  it("an authenticated team without an approved analytics request cannot read players.stats", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: "No-Analytics Team", eventEditionId });
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Locked Stats Player" });

      await asRole(client, "authenticated", { sub: teamId, app_metadata: {} });

      const { rows } = await client.query("select * from public.players where id = $1", [player.id]);
      expect(rows).toHaveLength(0);
    });
  });

  it("a team with an approved analytics request can read players.stats", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: "Analytics Approved Team", eventEditionId });
      await createTestAnalyticsRequest(client, { eventEditionId, teamId, status: "approved" });
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Unlocked Stats Player" });
      await client.query("update public.players set stats = $2 where id = $1", [
        player.id,
        JSON.stringify({ strike_rate: 150 }),
      ]);

      await asRole(client, "authenticated", { sub: teamId, app_metadata: {} });

      const { rows } = await client.query("select stats from public.players where id = $1", [player.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].stats).toEqual({ strike_rate: 150 });
    });
  });

  it("an admin can read players.stats regardless of any analytics request", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const adminId = await createTestAdmin(client);
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Admin Visible Player" });

      await asRole(client, "authenticated", { sub: adminId, app_metadata: { role: "admin" } });

      const { rows } = await client.query("select id from public.players where id = $1", [player.id]);
      expect(rows).toHaveLength(1);
    });
  });
});

// Audit P0 #3 — record_sale/reverse_sale/set_active_player/mark_player_unsold/
// recall_player never checked auction_state.ended_at.
describe("Audit P0 #3: auction mutations blocked once the auction has ended", () => {
  it("record_sale raises [auction_ended] once the auction has been ended", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "Ended Auction Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 1000 });
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Post-End Player", basePrice: 100 });
      const adminId = await createTestAdmin(client);

      await client.query(
        `insert into public.auction_state (event_edition_id, ended_at)
         values ($1, now())
         on conflict (event_edition_id) do update set ended_at = now()`,
        [eventEditionId],
      );

      const rejection = await expectRejection(
        client,
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid)",
        [player.id, teamId, 100, player.updatedAt, adminId],
      );
      expect(rejection.message).toMatch(/auction_ended/);
    });
  });

  it("set_active_player raises [auction_ended] once the auction has been ended", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Post-End Activation Player" });
      const adminId = await createTestAdmin(client);

      await client.query(
        `insert into public.auction_state (event_edition_id, ended_at)
         values ($1, now())
         on conflict (event_edition_id) do update set ended_at = now()`,
        [eventEditionId],
      );

      const rejection = await expectRejection(
        client,
        "select public.set_active_player($1, $2::timestamptz, $3::uuid)",
        [player.id, player.updatedAt, adminId],
      );
      expect(rejection.message).toMatch(/auction_ended/);
    });
  });
});

// Audit P0 #2 — qualification was enforced nowhere except can_team_submit();
// record_sale/admin_grant_starting_purses/submit_simulation_attempt/
// request_analytics all checked only teams.status = 'active'.
describe("Audit P0 #2: stage qualification enforced in the auction", () => {
  async function createGatedRound(client: Client, eventEditionId: string) {
    const { rows: stageRows } = await client.query(
      `insert into public.stages (event_edition_id, code, label) values ($1, 'r1_r2', 'Rounds 1-2')
       on conflict (event_edition_id, code) do update set label = excluded.label
       returning id`,
      [eventEditionId],
    );
    const stageId = stageRows[0].id;
    const { rows: roundRows } = await client.query(
      `insert into public.rounds (event_edition_id, kind, sequence, slug, title, requires_qualification_from_stage)
       values ($1, 'auction', 99, 'gated-round', 'Gated Round', $2)
       returning id`,
      [eventEditionId, stageId],
    );
    return { stageId, roundId: roundRows[0].id };
  }

  it("record_sale rejects a team that has not qualified for the player's round", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const { roundId } = await createGatedRound(client, eventEditionId);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "Unqualified Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 1000 });
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Gated Player", basePrice: 100 });
      await client.query("update public.players set round_id = $2 where id = $1", [player.id, roundId]);
      const adminId = await createTestAdmin(client);

      const rejection = await expectRejection(
        client,
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid)",
        [player.id, teamId, 100, player.updatedAt, adminId],
      );
      expect(rejection.message).toMatch(/team_not_qualified/);
    });
  });

  it("record_sale allows a team explicitly marked qualified for that stage", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const { stageId, roundId } = await createGatedRound(client, eventEditionId);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "Qualified Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 1000 });
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Gated Player 2", basePrice: 100 });
      await client.query("update public.players set round_id = $2 where id = $1", [player.id, roundId]);
      await client.query(
        `insert into public.qualifications (stage_id, team_id, rank, decision, decided_at)
         values ($1, $2, 1, 'qualified', now())`,
        [stageId, teamId],
      );
      const adminId = await createTestAdmin(client);

      const { rows } = await client.query(
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid) as result",
        [player.id, teamId, 100, player.updatedAt, adminId],
      );
      expect(rows[0].result.team_id).toBe(teamId);
    });
  });
});

// Audit P0 #4 — assert_admin() is the new gate every admin-attribution RPC
// calls before trusting a client-supplied admin id.
describe("Audit P0 #4: assert_admin rejects non-admins", () => {
  it("rejects a null admin id", async () => {
    await withTx(async (client) => {
      const rejection = await expectRejection(client, "select public.assert_admin($1)", [null]);
      expect(rejection.message).toMatch(/admin_required/);
    });
  });

  it("rejects a real user id that is not an admin", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: "Not An Admin", eventEditionId });
      const rejection = await expectRejection(client, "select public.assert_admin($1::uuid)", [teamId]);
      expect(rejection.message).toMatch(/admin_required/);
    });
  });

  it("record_sale rejects when p_admin_id is not a real admin", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "Impersonation Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 1000 });
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Impersonation Player", basePrice: 100 });

      const rejection = await expectRejection(
        client,
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid)",
        [player.id, teamId, 100, player.updatedAt, teamId],
      );
      expect(rejection.message).toMatch(/admin_required/);
    });
  });

  it("record_sale stamps the real admin id on sold_by, not null", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "Attribution Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 1000 });
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Attribution Player", basePrice: 100 });
      const adminId = await createTestAdmin(client);

      const { rows } = await client.query(
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid) as result",
        [player.id, teamId, 100, player.updatedAt, adminId],
      );
      const saleId = rows[0].result.sale_id;

      const { rows: saleRows } = await client.query("select sold_by from public.auction_sales where id = $1", [saleId]);
      expect(saleRows[0].sold_by).toBe(adminId);
    });
  });
});

// 20260807090000 — 20260802020000_admin_broadcast_topics.sql dropped the
// trailing p_admin_id param on five admin RPCs while doing `create or
// replace`, which (since Postgres resolves overloads by full signature)
// silently minted brand-new SECURITY DEFINER functions with Postgres's
// default PUBLIC EXECUTE grant and no assert_admin() call — anon and
// authenticated could call them directly. These two checks catch both the
// symptom (an exposed SECURITY DEFINER function) and the root cause (an
// accidental overload from a signature change), so this class of defect
// cannot ship silently again.
describe("SECURITY DEFINER functions are service_role-only", () => {
  // simulation_status(uuid) is a deliberate authenticated-only grant
  // (revoked from public/anon, granted to authenticated — 20260730060000)
  // so teams can poll simulation status while it's running.
  const ALLOWED = ["can_team_submit(uuid,uuid)", "simulation_status(uuid)"];

  it("no public.* SECURITY DEFINER function is executable by anon or authenticated, beyond the allowlist", async () => {
    await withTx(async (client) => {
      const { rows } = await client.query<{ signature: string }>(`
        select p.oid::regprocedure::text as signature
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          -- trigger/event_trigger functions have no callable SQL entry point
          -- (an event trigger, e.g. Supabase's platform-managed
          -- rls_auto_enable(), can only run inside the event-trigger
          -- machinery — attempting a direct SELECT of one is rejected by
          -- Postgres itself) so PUBLIC EXECUTE on them is not a real hole.
          and p.prorettype not in ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
          and (
            has_function_privilege('anon', p.oid, 'execute')
            or has_function_privilege('authenticated', p.oid, 'execute')
          )
        order by 1;
      `);
      expect(rows.map((r) => r.signature)).toEqual(ALLOWED);
    });
  });

  it("no admin_* function has more than one overload (the exact defect that caused the P0 above)", async () => {
    await withTx(async (client) => {
      const { rows } = await client.query<{ proname: string; overloads: number; signatures: string }>(`
        select p.proname, count(*)::int as overloads,
               string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text) as signatures
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'admin\\_%'
        group by p.proname
        having count(*) > 1;
      `);
      expect(rows).toEqual([]);
    });
  });
});

// 20260807090000 — restores the live-broadcast calls that 20260802020000
// added to the wrong (unreachable) overload, and the [attempt_not_a_win]
// guard that same migration silently dropped from
// admin_confirm_simulation_reward.
describe("20260807090000: admin RPC broadcasts and guards restored", () => {
  it("admin_publish_leaderboard writes a live_broadcast row and stamps published_by, not null", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const adminId = await createTestAdmin(client);

      const { rows } = await client.query(
        `select public.admin_publish_leaderboard($1, 'top_15', '[]'::jsonb, 15, $2) as snapshot_id`,
        [eventEditionId, adminId],
      );
      const snapshotId = rows[0].snapshot_id;

      const { rows: snapshotRows } = await client.query(
        "select published_by from public.leaderboard_snapshots where id = $1",
        [snapshotId],
      );
      expect(snapshotRows[0].published_by).toBe(adminId);

      const { rows: broadcastRows } = await client.query(
        `select 1 from public.live_broadcast
         where event_edition_id = $1 and topic = 'leaderboard' and kind = 'published'
           and payload ->> 'snapshot_id' = $2
         order by created_at desc limit 1`,
        [eventEditionId, snapshotId],
      );
      expect(broadcastRows).toHaveLength(1);
    });
  });

  it("admin_confirm_simulation_reward still rejects a non-winning attempt", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const adminId = await createTestAdmin(client);
      const teamId = await createTestTeam(client, { name: "Non-Winner Team", eventEditionId });

      const { rows: configRows } = await client.query(
        `insert into public.simulation_config
           (event_edition_id, parameters, scoring, answer_key, global_timer_seconds, submit_cooldown_seconds, defaults_overall)
         values ($1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 1500, 3, 70)
         returning id`,
        [eventEditionId],
      );
      const configId = configRows[0].id;

      const { rows: attemptRows } = await client.query(
        `insert into public.simulation_attempts
           (config_id, team_id, submitted_parameters, sub_scores, overall, success)
         values ($1, $2, '{}'::jsonb, '{}'::jsonb, 40, false)
         returning id`,
        [configId, teamId],
      );
      const attemptId = attemptRows[0].id;

      const rejection = await expectRejection(
        client,
        "select public.admin_confirm_simulation_reward($1, $2, $3, 'purse', 100, null, 'test', $4)",
        [configId, teamId, attemptId, adminId],
      );
      expect(rejection.message).toMatch(/attempt_not_a_win/);
    });
  });
});

// 20260807090000 — admin_upsert_quiz_question's previous fix
// (20260806120000) used `select max(position)+1 ... for update`, which
// Postgres rejects at runtime ("FOR UPDATE is not allowed with aggregate
// functions"). Every insert was broken on the hosted DB until this fix.
describe("20260807090000: quiz question position no longer breaks on insert", () => {
  it("two consecutive inserts on the same round land at consecutive positions", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const { rows: roundRows } = await client.query(
        `insert into public.rounds (event_edition_id, kind, sequence, slug, title)
         values ($1, 'quiz', 98, 'quiz-position-test', 'Quiz Position Test')
         returning id`,
        [eventEditionId],
      );
      const roundId = roundRows[0].id;
      const options = JSON.stringify([
        { position: 0, label: "A", is_correct: true },
        { position: 1, label: "B", is_correct: false },
      ]);

      const { rows: first } = await client.query(
        `select public.admin_upsert_quiz_question(null, $1, null, 'Q1', 20, 1, true, $2::jsonb) as id`,
        [roundId, options],
      );
      const { rows: second } = await client.query(
        `select public.admin_upsert_quiz_question(null, $1, null, 'Q2', 20, 1, true, $2::jsonb) as id`,
        [roundId, options],
      );

      const { rows: positions } = await client.query(
        "select id, position from public.quiz_questions where id in ($1, $2) order by position",
        [first[0].id, second[0].id],
      );
      expect(positions.map((r) => r.position)).toEqual([0, 1]);
    });
  });
});

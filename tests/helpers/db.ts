import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Integration tests run against the hosted DB (Docker is broken on this
 * machine, so no local Supabase — see CLAUDE.md). Every test opens its own
 * connection, wraps its body in BEGIN ... ROLLBACK, and calls the real RPCs
 * directly as the `postgres` role — which, being the function owner,
 * bypasses both RLS and the service_role-only grants the same way the
 * admin client does in production. Nothing is ever left behind.
 */
export async function withTx<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    // Without this, an unreachable pooler makes every one of the ~50 serial
    // tests (fileParallelism is off) block for the full 20s testTimeout —
    // that's what "the suite hung for 5+ minutes" actually was.
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    await client.query("begin");
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

/**
 * Every existing test connects as `postgres`, which is the owner of every
 * RPC/table in this schema — RLS and service_role-only grants never apply,
 * even inside a transaction. Testing that an RLS policy actually blocks or
 * allows a query requires switching the *session* role for the duration of
 * the transaction, which these two helpers do.
 */
export async function createTestAdmin(client: Client): Promise<string> {
  const { rows } = await client.query<{ id: string }>("select gen_random_uuid() as id");
  const id = rows[0]!.id;
  await client.query(
    `insert into auth.users (id, email, raw_app_meta_data)
     values ($1, $2, '{"role":"admin"}'::jsonb)`,
    [id, `${id}@admin.test.bidwave.local`],
  );
  return id;
}

/**
 * Runs inside the caller's already-open transaction: `set local role` and
 * `request.jwt.claims` both revert automatically at rollback, same as every
 * other test fixture. `claims` should at minimum carry `{ sub: <uuid> }` for
 * `authenticated`, since `auth.uid()` reads `request.jwt.claims ->> 'sub'`.
 */
export async function asRole(
  client: Client,
  role: "anon" | "authenticated",
  claims: Record<string, unknown> = {},
): Promise<void> {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`set local role ${role}`);
}

/**
 * Vitest suites roll back every transaction, so touching the live edition
 * is inherently safe here (unlike the e2e suite's destructive seed/unseed
 * scripts) — but honoring BIDWAVE_EVENT_EDITION_SLUG when set means these
 * integration tests exercise the same `e2e-test` edition Playwright does,
 * rather than silently diverging. Kept as getActiveEventEditionId (not
 * renamed) since every existing test file already imports it under that
 * name; the behavior is a superset of "active edition" now.
 */
export async function getActiveEventEditionId(client: Client): Promise<string> {
  const slug = process.env.BIDWAVE_EVENT_EDITION_SLUG;
  const { rows } = slug
    ? await client.query("select id from public.event_editions where slug = $1", [slug])
    : await client.query("select id from public.event_editions where is_active limit 1");
  if (!rows[0]) throw new Error(slug ? `No event edition with slug '${slug}'.` : "No active event edition in the hosted DB.");
  return rows[0].id;
}

/**
 * Creates a minimal auth.users row (teams.id is an FK to it) plus the
 * matching teams row, entirely inside the caller's transaction so it
 * vanishes on rollback along with everything else the test does.
 */
export async function createTestTeam(
  client: Client,
  opts: { name: string; eventEditionId: string; status?: "active" | "disqualified" },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>("select gen_random_uuid() as id");
  const id = rows[0]!.id;
  const email = `${id}@test.bidwave.local`;

  await client.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  await client.query(
    `insert into public.teams (id, event_edition_id, name, campus, captain_email, status)
     values ($1, $2, $3, 'Bangalore', $4, $5)`,
    [id, opts.eventEditionId, opts.name, email, opts.status ?? "active"],
  );

  return id;
}

/**
 * Postgres aborts the whole transaction after any error, so a test that
 * expects an RPC to raise and then wants to keep querying in the same
 * transaction needs a SAVEPOINT around the failing call — otherwise every
 * later query in that test fails with "current transaction is aborted".
 */
export async function expectRejection(client: Client, sql: string, params: unknown[]): Promise<Error> {
  await client.query("savepoint expect_rejection");
  try {
    await client.query(sql, params);
    throw new Error("Expected the query to reject, but it succeeded.");
  } catch (err) {
    await client.query("rollback to savepoint expect_rejection");
    return err as Error;
  }
}

export async function createTestPlayer(
  client: Client,
  opts: {
    eventEditionId: string;
    fullName: string;
    role?: string;
    basePrice?: number;
    pool?: string;
    nationality?: string;
    isOverseas?: boolean;
  },
): Promise<{ id: string; updatedAt: string }> {
  const { rows } = await client.query<{ id: string; updated_at: string }>(
    `insert into public.players (event_edition_id, full_name, role, base_price, pool, nationality, is_overseas)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, updated_at::text`,
    [
      opts.eventEditionId,
      opts.fullName,
      opts.role ?? "batter",
      opts.basePrice ?? 100,
      opts.pool ?? "A",
      opts.nationality ?? "India",
      opts.isOverseas ?? false,
    ],
  );
  return { id: rows[0]!.id, updatedAt: rows[0]!.updated_at };
}

export async function createTestAuctionRuleSet(
  client: Client,
  opts: {
    eventEditionId: string;
    startingPurse?: number;
    minSquadSize?: number;
    maxSquadSize?: number;
    maxOverseas?: number;
    roleLimits?: Record<string, unknown>;
    poolLimits?: Record<string, unknown>;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.auction_rule_sets
       (event_edition_id, is_active, starting_purse, min_squad_size, max_squad_size, max_overseas, role_limits, pool_limits)
     values ($1, true, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      opts.eventEditionId,
      opts.startingPurse ?? 1000,
      opts.minSquadSize ?? 0,
      opts.maxSquadSize ?? 15,
      opts.maxOverseas ?? 4,
      JSON.stringify(opts.roleLimits ?? {}),
      JSON.stringify(opts.poolLimits ?? {}),
    ],
  );
  return rows[0]!.id;
}

/** Direct insert, bypassing record_sale/admin_grant_starting_purses, for fast fixture setup. */
export async function grantTestPurse(
  client: Client,
  opts: { eventEditionId: string; teamId: string; amount: number },
): Promise<void> {
  await client.query(
    `insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount)
     values ($1, $2, 'start', $3)`,
    [opts.eventEditionId, opts.teamId, opts.amount],
  );
}

export async function createTestAnalyticsRequest(
  client: Client,
  opts: {
    eventEditionId: string;
    teamId: string;
    status?: "pending" | "approved" | "rejected";
    priceAtRequest?: number;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.analytics_requests (event_edition_id, team_id, status, price_at_request)
     values ($1, $2, $3, $4)
     returning id`,
    [opts.eventEditionId, opts.teamId, opts.status ?? "pending", opts.priceAtRequest ?? 500],
  );
  return rows[0]!.id;
}

export async function createTestRound(
  client: Client,
  opts: {
    eventEditionId: string;
    kind: "quiz" | "submission" | "offline_info" | "simulation" | "auction" | "conference";
    slug: string;
    sequence: number;
    opensAt?: Date | null;
    closesAt?: Date | null;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.rounds (event_edition_id, kind, sequence, slug, title, opens_at, closes_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [opts.eventEditionId, opts.kind, opts.sequence, opts.slug, opts.slug, opts.opensAt ?? null, opts.closesAt ?? null],
  );
  return rows[0]!.id;
}

/**
 * Throwaway migration applier — Docker is broken on this machine (see
 * CLAUDE.md), so `supabase db push` (which shells out to
 * `docker image inspect` for its shadow-DB check even with --db-url) can't
 * run. This connects directly with `pg` instead, applies one migration
 * file inside a transaction, and inserts into
 * supabase_migrations.schema_migrations so the CLI's own bookkeeping stays
 * consistent for whenever `db push` works again. Same pattern used for
 * migration 001 onward.
 *
 * Usage: node scripts/apply-migration.cjs supabase/migrations/<file>.sql
 */
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/apply-migration.cjs <path-to-migration.sql>");
    process.exit(1);
  }
  const sql = fs.readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath, ".sql");
  const version = fileName.split("_")[0];

  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  await pg.query("begin");
  try {
    await pg.query(sql);
    await pg.query(
      "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3) on conflict (version) do nothing",
      [version, fileName, [sql]],
    );
    await pg.query("commit");
    console.log(`Applied ${fileName}`);
  } catch (e) {
    await pg.query("rollback");
    throw e;
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error("MIGRATION FAILED:", e.message);
  process.exit(1);
});

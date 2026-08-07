/**
 * Shared by seed-demo.cjs and unseed-demo.cjs — both are destructive
 * (unseed disables purse_ledger_append_only/rounds_no_reopen and deletes
 * every team/sale/ledger-entry/score/submission for their target edition).
 * Originally both scripts unconditionally targeted `where is_active` —
 * fine while this hosted project was purely a rehearsal environment, but
 * the e2e suite's global-setup/teardown call these same scripts on every
 * run, and once BIDWAVE_EVENT_EDITION_SLUG points the app at a dedicated
 * non-active test edition (src/lib/event-edition.ts), these two scripts
 * are the only remaining path that could still nuke the live edition by
 * accident (e.g. a forgotten env var in a shell).
 *
 * Resolves BIDWAVE_EVENT_EDITION_SLUG when set, else falls back to
 * `is_active` (unchanged default), and refuses to proceed against the
 * live edition unless explicitly overridden.
 */
async function resolveEditionOrAbort(pg, { allowActiveEnvVar = "BIDWAVE_SEED_ALLOW_ACTIVE_EDITION" } = {}) {
  const slug = process.env.BIDWAVE_EVENT_EDITION_SLUG;
  const { rows } = slug
    ? await pg.query("select id, slug, is_active from public.event_editions where slug = $1", [slug])
    : await pg.query("select id, slug, is_active from public.event_editions where is_active limit 1");

  const edition = rows[0];
  if (!edition) {
    throw new Error(
      slug ? `No event edition with slug '${slug}'.` : "No active event edition — run migrations first.",
    );
  }

  if (edition.is_active && process.env[allowActiveEnvVar] !== "1") {
    throw new Error(
      `REFUSING to seed/unseed '${edition.slug}' — it is the ACTIVE (live) edition. ` +
        "These scripts delete every team, sale, ledger entry, score, submission and quiz " +
        "question for their target. Set BIDWAVE_EVENT_EDITION_SLUG=e2e-test, or " +
        `${allowActiveEnvVar}=1 if you really mean the live edition.`,
    );
  }

  return edition;
}

module.exports = { resolveEditionOrAbort };

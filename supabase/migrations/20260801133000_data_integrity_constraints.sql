-- Migration — Data-integrity hardening (audit high-priority #15, #16, #17)
--
-- Three independent, additive "tighten validation" fixes with no shared
-- code path — grouped in one migration because none needs its own
-- rollback story separate from the others.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- #15. auction_rule_sets had no CHECK constraints on purse/squad/overseas/
-- price fields, and admin_save_auction_rule_set() did zero validation
-- before insert/update — a negative starting_purse or an inverted
-- min/max_squad_size could corrupt purse or roster behavior downstream.
-- ---------------------------------------------------------------------------

alter table public.auction_rule_sets
  add constraint auction_rule_sets_starting_purse_non_negative check (starting_purse >= 0),
  add constraint auction_rule_sets_min_squad_size_non_negative check (min_squad_size >= 0),
  add constraint auction_rule_sets_max_overseas_non_negative check (max_overseas >= 0),
  add constraint auction_rule_sets_analytics_price_non_negative check (analytics_price >= 0),
  add constraint auction_rule_sets_squad_size_order check (max_squad_size >= min_squad_size);

create or replace function public.admin_save_auction_rule_set(
  p_rule_set_id uuid,
  p_expected_updated_at timestamptz,
  p_event_edition_id uuid,
  p_round_id uuid,
  p_starting_purse numeric,
  p_min_squad_size int,
  p_max_squad_size int,
  p_max_overseas int,
  p_role_limits jsonb,
  p_pool_limits jsonb,
  p_analytics_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual_updated_at timestamptz;
  v_id uuid;
begin
  if p_starting_purse < 0 then
    raise exception '[invalid_rule_set] Starting purse cannot be negative.';
  end if;
  if p_min_squad_size < 0 then
    raise exception '[invalid_rule_set] Minimum squad size cannot be negative.';
  end if;
  if p_max_squad_size < p_min_squad_size then
    raise exception '[invalid_rule_set] Maximum squad size cannot be less than the minimum.';
  end if;
  if p_max_overseas < 0 then
    raise exception '[invalid_rule_set] Maximum overseas count cannot be negative.';
  end if;
  if p_analytics_price < 0 then
    raise exception '[invalid_rule_set] Analytics price cannot be negative.';
  end if;

  if p_rule_set_id is not null then
    select updated_at into v_actual_updated_at from public.auction_rule_sets where id = p_rule_set_id for update;
    if v_actual_updated_at is null then
      raise exception '[not_found] Rule set not found.';
    end if;
    if v_actual_updated_at <> p_expected_updated_at then
      raise exception '[stale_edit] This rule set was edited elsewhere — refresh and try again.';
    end if;

    update public.auction_rule_sets set
      round_id = p_round_id, starting_purse = p_starting_purse, min_squad_size = p_min_squad_size,
      max_squad_size = p_max_squad_size, max_overseas = p_max_overseas, role_limits = p_role_limits,
      pool_limits = p_pool_limits, analytics_price = p_analytics_price
    where id = p_rule_set_id
    returning id into v_id;
  else
    update public.auction_rule_sets set is_active = false
    where event_edition_id = p_event_edition_id and is_active;

    insert into public.auction_rule_sets (
      event_edition_id, round_id, is_active, starting_purse, min_squad_size, max_squad_size,
      max_overseas, role_limits, pool_limits, analytics_price
    ) values (
      p_event_edition_id, p_round_id, true, p_starting_purse, p_min_squad_size, p_max_squad_size,
      p_max_overseas, p_role_limits, p_pool_limits, p_analytics_price
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

comment on function public.admin_save_auction_rule_set(uuid, timestamptz, uuid, uuid, numeric, int, int, int, jsonb, jsonb, numeric) is
  'Creating a new rule set (p_rule_set_id null) deactivates any existing '
  'active set first — the partial unique index enforces at most one active '
  'set per edition either way, this just avoids relying on the constraint '
  'to surface the intent. Validates purse/squad/overseas/price bounds '
  'before writing (audit high-priority #15) so a bad value surfaces as a '
  'clean app-level error instead of a raw constraint violation.';

-- ---------------------------------------------------------------------------
-- #17. leaderboard_snapshot_entries only uniquely constrained (snapshot_id,
-- rank) — nothing stopped the same team_name appearing at multiple ranks,
-- and nothing enforced the "exact top 10" shape for a final_top_10
-- snapshot. Entries are inserted one row at a time inside
-- admin_publish_leaderboard()'s loop, so a plain CHECK can't count
-- siblings — a deferred constraint trigger (fires once at commit) is the
-- right primitive here, same idiom as rounds_no_reopen()'s belt-and-
-- suspenders instinct.
-- ---------------------------------------------------------------------------

alter table public.leaderboard_snapshot_entries
  add constraint leaderboard_snapshot_entries_team_name_unique unique (snapshot_id, team_name);

create or replace function public.leaderboard_snapshot_entry_count_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_snapshot_id uuid;
  v_kind text;
  v_entry_limit int;
  v_count int;
begin
  v_snapshot_id := coalesce(new.snapshot_id, old.snapshot_id);

  select kind, entry_limit into v_kind, v_entry_limit
  from public.leaderboard_snapshots where id = v_snapshot_id;

  if v_kind is null or v_kind <> 'final_top_10' then
    return null;
  end if;

  select count(*) into v_count from public.leaderboard_snapshot_entries where snapshot_id = v_snapshot_id;

  if v_count <> v_entry_limit then
    raise exception '[invalid_final_top_10] A final_top_10 snapshot must have exactly % entries (has %).',
      v_entry_limit, v_count;
  end if;

  return null;
end;
$$;

comment on function public.leaderboard_snapshot_entry_count_check() is
  'Audit high-priority #17: enforces the exact top-10 row count for a '
  'final_top_10 snapshot. Only that kind is constrained — top_15 may '
  'legitimately have fewer entries than its limit if fewer teams exist.';

create constraint trigger leaderboard_snapshot_entries_count_check
  after insert or delete on public.leaderboard_snapshot_entries
  deferrable initially deferred
  for each row execute function public.leaderboard_snapshot_entry_count_check();

-- ---------------------------------------------------------------------------
-- #16. Player import always hardcoded player_stat_definitions.data_type to
-- 'text', so imported numeric statistics could never power the
-- "undervalued player" analytics filter (analytics-module.tsx filters on
-- data_type === 'number'). Infer the type from the actual imported JSON
-- value instead.
-- ---------------------------------------------------------------------------

create or replace function public.admin_import_players(
  p_event_edition_id uuid,
  p_round_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_stat_key text;
  v_stat_type text;
begin
  for v_row in select * from jsonb_array_elements(p_rows) loop
    begin
      insert into public.players (
        event_edition_id, round_id, external_ref, full_name, role, base_price,
        pool, nationality, ipl_team, is_overseas, stats
      ) values (
        p_event_edition_id, p_round_id, v_row ->> 'externalRef', v_row ->> 'fullName',
        v_row ->> 'role', (v_row ->> 'basePrice')::numeric, v_row ->> 'pool',
        v_row ->> 'nationality', v_row ->> 'iplTeam',
        coalesce(lower(v_row ->> 'nationality') <> 'india', false),
        coalesce(v_row -> 'stats', '{}'::jsonb)
      );
      v_inserted := v_inserted + 1;

      for v_stat_key in select jsonb_object_keys(coalesce(v_row -> 'stats', '{}'::jsonb)) loop
        v_stat_type := case jsonb_typeof(v_row -> 'stats' -> v_stat_key)
          when 'number' then 'number'
          when 'boolean' then 'boolean'
          else 'text'
        end;

        insert into public.player_stat_definitions (event_edition_id, key, label, data_type)
        values (p_event_edition_id, v_stat_key, v_stat_key, v_stat_type)
        on conflict (event_edition_id, key) do nothing;
      end loop;
    exception when unique_violation then
      v_errors := v_errors || jsonb_build_object(
        'external_ref', v_row ->> 'externalRef',
        'full_name', v_row ->> 'fullName',
        'error', 'duplicate_external_ref'
      );
    end;
  end loop;

  -- 'error_rows' persists the full array so a later export (REP-04) can
  -- rebuild the exact same CSV the admin saw live, instead of only a count.
  perform public.log_activity(
    p_event_edition_id, null, 'admin', 'players_imported',
    jsonb_build_object('inserted', v_inserted, 'errors', jsonb_array_length(v_errors), 'error_rows', v_errors)
  );

  return jsonb_build_object('inserted_count', v_inserted, 'errors', v_errors);
end;
$$;

comment on function public.admin_import_players(uuid, uuid, jsonb) is
  'AUC-05: deliberate exception to "zero partial writes" — the per-row '
  'begin/exception block means valid rows commit even when some rows are '
  'invalid, by design (the "zero partial writes" contract in AUC-10/AT-'
  'AUC-02 is scoped to sale-rule validation, a different operation). '
  'REP-04: full error detail also persisted to activity_events.detail.error_rows. '
  'data_type is now inferred from jsonb_typeof() per stat key (audit '
  'high-priority #16) instead of hardcoded to ''text'', so numeric imports '
  'actually power the "undervalued player" analytics filter.';

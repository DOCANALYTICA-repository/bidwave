-- Migration 006 — Auction
--
-- Players, extensible stats, configurable rule sets, an append-only purse
-- ledger, the sale/reversal engine, a soft record-lock concurrency primitive
-- for shared-admin-account multi-device use, an audit trail, and a public
-- broadcast table that Realtime clients subscribe to. Also validates Phase
-- 5's forward reference (simulation_rewards.purse_ledger_entry_id) and
-- consumes its pending_simulation_purse_awards view.
--
-- PRD references: §14 (AUC-01..20), §15 (LIVE-01..08), §16 (TEAM-AUC-01..06),
-- §21.3, §24.4, §28.5 (AT-AUC-01..05).

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Player stat definitions — AUC-07: extensible metrics beyond the mandatory
-- identity fields, so the UI can label/type-render players.stats keys
-- without hardcoded columns.
-- ---------------------------------------------------------------------------

create table public.player_stat_definitions (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  key text not null,
  label text not null,
  data_type text not null check (data_type in ('number', 'text', 'boolean')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  constraint player_stat_definitions_key_unique unique (event_edition_id, key)
);

comment on table public.player_stat_definitions is
  'AUC-07: labels/types for players.stats keys, discovered from imported '
  'data — no fixed column list, since the real stat set (DEP-05) is not '
  'yet known.';

alter table public.player_stat_definitions enable row level security;

create policy "player_stat_definitions_select_all"
  on public.player_stat_definitions for select
  to anon, authenticated
  using (true);

create policy "player_stat_definitions_admin_write"
  on public.player_stat_definitions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Players — AUC-01..07. RLS is fully public: nothing about a player
-- (including stats) is private, so the public tracker (LIVE-02/03) and the
-- team dashboard (TEAM-AUC-01) query this table directly.
-- ---------------------------------------------------------------------------

create table public.players (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  round_id uuid references public.rounds (id) on delete set null,
  external_ref text,
  full_name text not null,
  role text not null,
  base_price numeric(14, 2) not null check (base_price >= 0),
  pool text not null,
  nationality text not null,
  is_overseas boolean not null default false,
  ipl_team text,
  stats jsonb not null default '{}'::jsonb,
  status text not null default 'available'
    check (status in ('available', 'active', 'sold', 'unsold', 'recalled')),
  current_team_id uuid references public.teams (id) on delete set null,
  sale_price numeric(14, 2),
  sold_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_external_ref_unique unique (event_edition_id, external_ref)
);

comment on table public.players is
  '§21.3 state machine: import -> available; set_active_player: '
  'available|recalled -> active; record_sale: available|active|recalled -> '
  'sold; mark_player_unsold: available|active -> unsold; recall_player: '
  'unsold -> recalled only; reverse_sale: sold -> available directly '
  '(never recalled — recall is a deliberate re-listing decision, reversal '
  'is "this sale should not have happened").';

-- LIVE-03/AUC-09: at most one player "active" (up for bidding) at a time
-- per edition.
create unique index players_one_active_per_edition
  on public.players (event_edition_id)
  where status = 'active';

create index players_event_edition_pool_idx on public.players (event_edition_id, pool);
create index players_current_team_id_idx on public.players (current_team_id)
  where current_team_id is not null;

create trigger set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

alter table public.players enable row level security;

create policy "players_select_all"
  on public.players for select
  to anon, authenticated
  using (true);

create policy "players_admin_write"
  on public.players for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Auction rule sets — §14.3. DEP-06's real numbers are still pending from
-- the client; every default below is a clearly-placeholder value the admin
-- replaces via /admin/auction/rules with no code change.
-- ---------------------------------------------------------------------------

create table public.auction_rule_sets (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  round_id uuid references public.rounds (id) on delete set null,
  is_active boolean not null default false,
  starting_purse numeric(14, 2) not null default 100000000,
  min_squad_size int not null default 11,
  max_squad_size int not null default 18,
  max_overseas int not null default 4,
  role_limits jsonb not null default '{}'::jsonb,
  pool_limits jsonb not null default '{}'::jsonb,
  analytics_price numeric(14, 2) not null default 500,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.auction_rule_sets is
  'starting_purse/analytics_price are reference values only — they never '
  'become purse truth by themselves; admin_grant_starting_purses() is the '
  'explicit act that turns starting_purse into real ledger rows (principle '
  '#4: configuration and ledger fact stay separate).';

create unique index auction_rule_sets_one_active
  on public.auction_rule_sets (event_edition_id)
  where is_active;

create trigger set_updated_at
  before update on public.auction_rule_sets
  for each row execute function public.set_updated_at();

alter table public.auction_rule_sets enable row level security;

create policy "auction_rule_sets_select_authenticated"
  on public.auction_rule_sets for select
  to authenticated
  using (true);

create policy "auction_rule_sets_admin_write"
  on public.auction_rule_sets for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Purse ledger — principle #4: append-only, never a mutable column.
-- ---------------------------------------------------------------------------

create table public.purse_ledger (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  entry_kind text not null
    check (entry_kind in ('start', 'sim_bonus', 'purchase', 'reversal', 'analytics', 'adjustment')),
  amount numeric(14, 2) not null,
  ref_kind text,
  ref_id uuid,
  memo text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

comment on table public.purse_ledger is
  'Append-only (see purse_ledger_append_only trigger below). amount is '
  'signed: purchase/analytics negative, start/sim_bonus/reversal positive, '
  'adjustment either. ref_kind/ref_id are a free-form pointer with no FK — '
  'the same cross-feature-decoupling idiom as stage_adjustments.source_ref '
  '— so this table never needs to know about auction_sales/'
  'simulation_rewards/analytics_requests as a hard dependency. entry_kind '
  'already includes ''analytics'' so Phase 7''s approve_analytics() needs '
  'zero further ledger-schema migrations.';

create unique index purse_ledger_one_start_per_team
  on public.purse_ledger (team_id)
  where entry_kind = 'start';

create index purse_ledger_team_id_created_at_idx
  on public.purse_ledger (team_id, created_at desc);

alter table public.purse_ledger enable row level security;

create policy "purse_ledger_select_own_or_admin"
  on public.purse_ledger for select
  to authenticated
  using (team_id = (select auth.uid()) or public.is_admin());

-- Deliberately no insert/update/delete policy for any client role — every
-- write goes through record_sale/reverse_sale/admin_grant_starting_purses/
-- admin_apply_pending_simulation_rewards, all service_role-only RPCs.

-- Belt-and-suspenders with the grant absence above: a SECURITY DEFINER
-- function runs as its *owner*, so table grants alone don't constrain a
-- future buggy function. Same two-layer instinct as rounds_no_reopen().
create or replace function public.purse_ledger_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '[purse_ledger_immutable] The purse ledger is append-only; corrections are compensating entries.';
end;
$$;

create trigger purse_ledger_append_only
  before update or delete on public.purse_ledger
  for each row execute function public.purse_ledger_append_only();

-- Balance is always derived, never stored.
create view public.team_purse_balances
with (security_invoker = true)
as
select
  t.id as team_id,
  t.event_edition_id,
  coalesce(sum(pl.amount), 0)::numeric(14, 2) as balance
from public.teams t
left join public.purse_ledger pl on pl.team_id = t.id
group by t.id, t.event_edition_id;

comment on view public.team_purse_balances is
  'security_invoker = true — a team querying this only ever gets its own '
  'row, via teams'' existing RLS chain.';

-- Phase 5's forward reference, now validated.
alter table public.simulation_rewards
  add constraint simulation_rewards_purse_ledger_entry_id_fkey
  foreign key (purse_ledger_entry_id) references public.purse_ledger (id);

-- ---------------------------------------------------------------------------
-- Starting-purse grant and pending-simulation-reward consumption
-- ---------------------------------------------------------------------------

-- The partial unique index on purse_ledger(team_id) where entry_kind='start'
-- means ON CONFLICT needs an explicit inference target against it.
create or replace function public.admin_grant_starting_purses(p_event_edition_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule_set public.auction_rule_sets;
  v_team record;
  v_granted int := 0;
  v_inserted uuid;
begin
  select * into v_rule_set from public.auction_rule_sets
  where event_edition_id = p_event_edition_id and is_active;

  if v_rule_set.id is null then
    raise exception '[not_found] No active auction rule set for this edition.';
  end if;

  for v_team in
    select id from public.teams
    where event_edition_id = p_event_edition_id and status = 'active'
    order by id
    for update
  loop
    insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, created_by)
    values (p_event_edition_id, v_team.id, 'start', v_rule_set.starting_purse, auth.uid())
    on conflict (team_id) where (entry_kind = 'start') do nothing
    returning id into v_inserted;

    if v_inserted is not null then
      v_granted := v_granted + 1;
    end if;
    v_inserted := null;
  end loop;

  perform public.log_activity(
    p_event_edition_id, null, 'admin', 'starting_purses_granted',
    jsonb_build_object('granted', v_granted)
  );

  return v_granted;
end;
$$;

create or replace function public.admin_apply_pending_simulation_rewards()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_award record;
  v_ledger_id uuid;
  v_applied int := 0;
begin
  for v_award in
    select * from public.pending_simulation_purse_awards
    order by simulation_reward_id
  loop
    -- Lock the team row first — the same invariant every purse-writing
    -- function in this migration follows, so concurrent purse writers for
    -- the same team are always serialized on the team row, never on
    -- purse_ledger itself.
    perform 1 from public.teams where id = v_award.team_id for update;

    insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id)
    values (v_award.event_edition_id, v_award.team_id, 'sim_bonus', v_award.amount,
            'simulation_reward', v_award.simulation_reward_id)
    returning id into v_ledger_id;

    update public.simulation_rewards
    set purse_applied_at = now(), purse_ledger_entry_id = v_ledger_id
    where id = v_award.simulation_reward_id and purse_applied_at is null;

    v_applied := v_applied + 1;
  end loop;

  return v_applied;
end;
$$;

comment on function public.admin_apply_pending_simulation_rewards() is
  'Consumes pending_simulation_purse_awards (migration 005). Idempotent: '
  'the view itself only ever returns rows where purse_applied_at is null, '
  'so a second run processes zero rows. Safe to run every minute via cron '
  '(principle #3 — cron only materializes something already valid).';

select cron.schedule(
  'apply-pending-simulation-purse-awards',
  '* * * * *',
  $cron$select public.admin_apply_pending_simulation_rewards();$cron$
);

-- ---------------------------------------------------------------------------
-- Player import (AUC-02/03/05) and rule-set admin RPCs
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
        insert into public.player_stat_definitions (event_edition_id, key, label, data_type)
        values (p_event_edition_id, v_stat_key, v_stat_key, 'text')
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

  perform public.log_activity(
    p_event_edition_id, null, 'admin', 'players_imported',
    jsonb_build_object('inserted', v_inserted, 'errors', jsonb_array_length(v_errors))
  );

  return jsonb_build_object('inserted_count', v_inserted, 'errors', v_errors);
end;
$$;

comment on function public.admin_import_players(uuid, uuid, jsonb) is
  'AUC-05: deliberate exception to "zero partial writes" — the per-row '
  'begin/exception block means valid rows commit even when some rows are '
  'invalid, by design (the "zero partial writes" contract in AUC-10/AT-'
  'AUC-02 is scoped to sale-rule validation, a different operation).';

create or replace function public.admin_upsert_player(
  p_player_id uuid,
  p_expected_updated_at timestamptz,
  p_event_edition_id uuid,
  p_round_id uuid,
  p_full_name text,
  p_role text,
  p_base_price numeric,
  p_pool text,
  p_nationality text,
  p_is_overseas boolean,
  p_ipl_team text,
  p_stats jsonb
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
  if p_player_id is not null then
    select updated_at into v_actual_updated_at from public.players where id = p_player_id for update;
    if v_actual_updated_at is null then
      raise exception '[not_found] Player not found.';
    end if;
    if v_actual_updated_at <> p_expected_updated_at then
      raise exception '[stale_edit] This player was edited elsewhere — refresh and try again.';
    end if;

    update public.players set
      round_id = p_round_id, full_name = p_full_name, role = p_role, base_price = p_base_price,
      pool = p_pool, nationality = p_nationality, is_overseas = p_is_overseas, ipl_team = p_ipl_team,
      stats = p_stats
    where id = p_player_id
    returning id into v_id;
  else
    insert into public.players (
      event_edition_id, round_id, full_name, role, base_price, pool, nationality, is_overseas, ipl_team, stats
    ) values (
      p_event_edition_id, p_round_id, p_full_name, p_role, p_base_price, p_pool, p_nationality,
      p_is_overseas, p_ipl_team, p_stats
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

comment on function public.admin_upsert_player(uuid, timestamptz, uuid, uuid, text, text, numeric, text, text, boolean, text, jsonb) is
  'AUC-03: manual add/edit at any time. No delete RPC — deleting a player '
  'with sale/audit history would destroy the audit trail; corrections go '
  'through edit, not deletion.';

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
  'to surface the intent.';

-- ---------------------------------------------------------------------------
-- Auction state — singleton per edition, "what is happening right now".
-- ---------------------------------------------------------------------------

create table public.auction_state (
  event_edition_id uuid primary key references public.event_editions (id) on delete cascade,
  round_id uuid references public.rounds (id) on delete set null,
  active_player_id uuid references public.players (id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

comment on table public.auction_state is
  'Distinct from rounds.closed_at: the round''s clock is a scheduling '
  'display, ended_at is the deliberate "swap /live to final-summary mode" '
  'moment (LIVE-08) — admin can keep recording sales after the round''s '
  'nominal window since this is a physically offline auction.';

create trigger set_updated_at
  before update on public.auction_state
  for each row execute function public.set_updated_at();

alter table public.auction_state enable row level security;

create policy "auction_state_select_all"
  on public.auction_state for select
  to anon, authenticated
  using (true);

create policy "auction_state_admin_write"
  on public.auction_state for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Record locks — AUC-13..16: a soft, TTL-based "someone else has this open"
-- indicator. AUC-13 means one shared auth.users admin account across every
-- device, so auth.uid() can never distinguish device A from B — the
-- per-device signal comes from a client-generated device_label +
-- session_token instead.
-- ---------------------------------------------------------------------------

create table public.record_locks (
  record_type text not null check (record_type in ('player', 'sale')),
  record_id uuid not null,
  locked_by uuid not null references auth.users (id),
  device_label text,
  session_token uuid not null default gen_random_uuid(),
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  primary key (record_type, record_id)
);

comment on table public.record_locks is
  'AUC-14: advisory, TTL-based "someone else has this open" indicator ONLY. '
  'It warns the UI; it does NOT gate record_sale()/reverse_sale() at the '
  'RPC level. The actual race-safety guarantee (AUC-15/AT-AUC-05) is the '
  'row lock + p_expected_updated_at check inside those functions, which '
  'apply regardless of whether a soft lock was ever acquired — a crashed '
  'tab that never releases its lock must never block a legitimate sale.';

alter table public.record_locks enable row level security;

create policy "record_locks_select_admin"
  on public.record_locks for select
  to authenticated
  using (public.is_admin());

-- No client write policy — acquire/heartbeat/release below are the only path.

create or replace function public.acquire_record_lock(
  p_record_type text,
  p_record_id uuid,
  p_device_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock public.record_locks;
  v_token uuid := gen_random_uuid();
begin
  select * into v_lock from public.record_locks
  where record_type = p_record_type and record_id = p_record_id
  for update;

  if v_lock.record_id is not null and v_lock.heartbeat_at > now() - interval '20 seconds' then
    raise exception '[record_locked] Currently being edited elsewhere.'
      using detail = jsonb_build_object(
        'locked_by', v_lock.locked_by, 'device_label', v_lock.device_label,
        'acquired_at', v_lock.acquired_at
      )::text;
  end if;

  insert into public.record_locks (record_type, record_id, locked_by, device_label, session_token)
  values (p_record_type, p_record_id, auth.uid(), p_device_label, v_token)
  on conflict (record_type, record_id) do update set
    locked_by = excluded.locked_by, device_label = excluded.device_label,
    session_token = excluded.session_token, acquired_at = now(), heartbeat_at = now();

  return jsonb_build_object('session_token', v_token, 'ttl_seconds', 20);
end;
$$;

create or replace function public.heartbeat_record_lock(
  p_record_type text,
  p_record_id uuid,
  p_session_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.record_locks set heartbeat_at = now()
  where record_type = p_record_type and record_id = p_record_id and session_token = p_session_token;

  if not found then
    raise exception '[lock_session_replaced] This lock session is no longer active.';
  end if;
end;
$$;

create or replace function public.release_record_lock(
  p_record_type text,
  p_record_id uuid,
  p_session_token uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.record_locks
  where record_type = p_record_type and record_id = p_record_id and session_token = p_session_token;
$$;

-- ---------------------------------------------------------------------------
-- Sales, audit, broadcast
-- ---------------------------------------------------------------------------

create table public.auction_sales (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  sold_at timestamptz not null default now(),
  sold_by uuid references auth.users (id),
  reversed_at timestamptz,
  reversed_by uuid references auth.users (id),
  reversal_reason text,
  purse_ledger_entry_id uuid references public.purse_ledger (id),
  reversal_ledger_entry_id uuid references public.purse_ledger (id),
  created_at timestamptz not null default now()
);

create index auction_sales_player_id_idx on public.auction_sales (player_id);
create index auction_sales_team_id_idx on public.auction_sales (team_id);
create index auction_sales_event_edition_sold_at_idx on public.auction_sales (event_edition_id, sold_at desc);

alter table public.auction_sales enable row level security;

create policy "auction_sales_select_own_or_admin"
  on public.auction_sales for select
  to authenticated
  using (team_id = (select auth.uid()) or public.is_admin());

create policy "auction_sales_admin_write"
  on public.auction_sales for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table public.auction_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  kind text not null check (kind in (
    'player_imported', 'player_edited', 'player_activated', 'player_sold', 'player_unsold',
    'player_recalled', 'sale_reversed', 'rule_set_saved', 'auction_started', 'auction_ended',
    'simulation_purse_applied'
  )),
  player_id uuid references public.players (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  sale_id uuid references public.auction_sales (id) on delete set null,
  actor_id uuid references auth.users (id),
  before_state jsonb,
  after_state jsonb,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.auction_audit_events is
  'AUC-20: the internal, richer audit trail — admin-only, distinct from the '
  'public sales feed (public_sales_feed view below).';

create index auction_audit_events_event_edition_created_at_idx
  on public.auction_audit_events (event_edition_id, created_at desc);

alter table public.auction_audit_events enable row level security;

create policy "auction_audit_events_select_admin"
  on public.auction_audit_events for select
  to authenticated
  using (public.is_admin());

-- No client write policy — only written via the RPCs in this migration.

create table public.live_broadcast (
  id bigint generated always as identity primary key,
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  topic text not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.live_broadcast is
  'principle #5: every state-change RPC routes through broadcast_live() '
  'below — one choke point to audit that everything written here is '
  'public-safe. Sale amounts are intentionally public (LIVE-04/TEAM-AUC-02) '
  '— this is not the kind of private data principle #5 guards against.';

create index live_broadcast_topic_created_at_idx
  on public.live_broadcast (event_edition_id, topic, created_at desc);

alter table public.live_broadcast enable row level security;

create policy "live_broadcast_select_all"
  on public.live_broadcast for select
  to anon, authenticated
  using (true);

-- No client write policy at all — only broadcast_live() below writes here.

create or replace function public.broadcast_live(
  p_event_edition_id uuid,
  p_topic text,
  p_kind text,
  p_payload jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.live_broadcast (event_edition_id, topic, kind, payload)
  values (p_event_edition_id, p_topic, p_kind, p_payload);
$$;

alter publication supabase_realtime add table public.live_broadcast;

-- Curated public views — deliberately NOT security_invoker: the goal here
-- is column-curation that must bypass base-table RLS (teams.captain_email
-- must never reach anon regardless of which columns a security_invoker
-- view happened to pick, since RLS is row-level, not column-level).
create view public.public_team_purses as
select
  t.id as team_id,
  t.event_edition_id,
  t.name,
  t.campus,
  coalesce(sum(pl.amount), 0)::numeric(14, 2) as purse_balance
from public.teams t
left join public.purse_ledger pl on pl.team_id = t.id
group by t.id, t.event_edition_id, t.name, t.campus;

create view public.public_sales_feed as
select
  s.id, s.player_id, p.full_name as player_name, p.role, p.pool,
  s.team_id, t.name as team_name, s.amount, s.sold_at, s.reversed_at, s.reversal_reason
from public.auction_sales s
join public.players p on p.id = s.player_id
join public.teams t on t.id = s.team_id;

grant select on public.public_team_purses to anon, authenticated;
grant select on public.public_sales_feed to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sale engine — AUC-08..20, AT-AUC-01..05
-- ---------------------------------------------------------------------------

create or replace function public.record_sale(
  p_player_id uuid,
  p_team_id uuid,
  p_amount numeric,
  p_expected_player_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
  v_team public.teams;
  v_rule_set public.auction_rule_sets;
  v_purse_balance numeric;
  v_sold_count int;
  v_role_count int;
  v_overseas_count int;
  v_pool_count int;
  v_violations jsonb := '[]'::jsonb;
  v_sale_id uuid;
  v_ledger_id uuid;
  v_role_max int;
  v_pool_max int;
begin
  -- 1. Lock the player row first — fixed global lock order (player, then
  -- team) across every function in this migration that touches both, so no
  -- two auction functions can ever deadlock against each other.
  select * into v_player from public.players where id = p_player_id for update;
  if v_player.id is null then
    raise exception '[not_found] Player not found.';
  end if;

  -- 2. Optimistic concurrency BEFORE any business check (AUC-15/AT-AUC-05) —
  -- a stale caller should be told to refresh, not shown a rule violation
  -- computed against an assumption that's already wrong.
  if v_player.updated_at <> p_expected_player_updated_at then
    raise exception '[stale_edit] This player changed on another device — refresh and try again.';
  end if;

  if v_player.status not in ('available', 'active', 'recalled') then
    raise exception '[player_not_sellable] This player is not currently sellable (status: %).', v_player.status;
  end if;

  -- 3. Lock the team row second, same order every time.
  select * into v_team from public.teams where id = p_team_id for update;
  if v_team.id is null then
    raise exception '[not_found] Team not found.';
  end if;
  if v_team.status <> 'active' then
    raise exception '[team_not_eligible] Team is not active.';
  end if;

  select * into v_rule_set from public.auction_rule_sets
  where event_edition_id = v_player.event_edition_id and is_active;
  if v_rule_set.id is null then
    raise exception '[not_found] No active auction rule set.';
  end if;

  select coalesce(sum(amount), 0) into v_purse_balance
  from public.purse_ledger where team_id = p_team_id;

  select count(*) into v_sold_count
  from public.players where current_team_id = p_team_id and status = 'sold';

  select count(*) into v_role_count
  from public.players where current_team_id = p_team_id and status = 'sold' and role = v_player.role;

  select count(*) into v_overseas_count
  from public.players where current_team_id = p_team_id and status = 'sold' and is_overseas;

  select count(*) into v_pool_count
  from public.players where current_team_id = p_team_id and status = 'sold' and pool = v_player.pool;

  if v_purse_balance < p_amount then
    v_violations := v_violations || jsonb_build_object(
      'rule', 'insufficient_purse', 'balance', v_purse_balance, 'amount', p_amount
    );
  end if;

  if v_sold_count + 1 > v_rule_set.max_squad_size then
    v_violations := v_violations || jsonb_build_object(
      'rule', 'squad_size_exceeded', 'max', v_rule_set.max_squad_size
    );
  end if;

  v_role_max := (v_rule_set.role_limits -> v_player.role ->> 'max')::int;
  if v_role_max is not null and v_role_count + 1 > v_role_max then
    v_violations := v_violations || jsonb_build_object('rule', 'role_cap_exceeded', 'role', v_player.role);
  end if;

  if v_player.is_overseas and v_overseas_count + 1 > v_rule_set.max_overseas then
    v_violations := v_violations || jsonb_build_object('rule', 'overseas_cap_exceeded');
  end if;

  v_pool_max := (v_rule_set.pool_limits -> v_player.pool ->> 'max')::int;
  if v_pool_max is not null and v_pool_count + 1 > v_pool_max then
    v_violations := v_violations || jsonb_build_object('rule', 'pool_cap_exceeded', 'pool', v_player.pool);
  end if;

  if jsonb_array_length(v_violations) > 0 then
    raise exception '[sale_blocked] % rule(s) violated.', jsonb_array_length(v_violations)
      using detail = v_violations::text;
  end if;

  update public.players set
    status = 'sold', current_team_id = p_team_id, sale_price = p_amount, sold_at = now()
  where id = p_player_id;

  insert into public.auction_sales (event_edition_id, player_id, team_id, amount, sold_by)
  values (v_player.event_edition_id, p_player_id, p_team_id, p_amount, auth.uid())
  returning id into v_sale_id;

  insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, created_by)
  values (v_player.event_edition_id, p_team_id, 'purchase', -p_amount, 'auction_sales', v_sale_id, auth.uid())
  returning id into v_ledger_id;

  update public.auction_sales set purse_ledger_entry_id = v_ledger_id where id = v_sale_id;

  insert into public.auction_audit_events (
    event_edition_id, kind, player_id, team_id, sale_id, actor_id, before_state, after_state
  ) values (
    v_player.event_edition_id, 'player_sold', p_player_id, p_team_id, v_sale_id, auth.uid(),
    to_jsonb(v_player), jsonb_build_object('status', 'sold', 'team_id', p_team_id, 'amount', p_amount)
  );

  perform public.broadcast_live(
    v_player.event_edition_id, 'auction', 'sale',
    jsonb_build_object('player_id', p_player_id, 'team_id', p_team_id, 'sale_id', v_sale_id, 'amount', p_amount)
  );

  return jsonb_build_object('sale_id', v_sale_id, 'player_id', p_player_id, 'team_id', p_team_id, 'amount', p_amount);
end;
$$;

comment on function public.record_sale(uuid, uuid, numeric, timestamptz) is
  'AUC-08..12, AT-AUC-01..03. Returns every violated rule via the '
  'exception''s DETAIL (not just the first) — see the [sale_blocked] raise.';

create or replace function public.reverse_sale(
  p_sale_id uuid,
  p_reason text,
  p_expected_player_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.auction_sales;
  v_player public.players;
  v_team public.teams;
  v_ledger_id uuid;
begin
  select * into v_sale from public.auction_sales where id = p_sale_id for update;
  if v_sale.id is null then
    raise exception '[not_found] Sale not found.';
  end if;
  if v_sale.reversed_at is not null then
    raise exception '[already_reversed] This sale was already reversed.';
  end if;

  -- Same global lock order as record_sale: player row, then team row.
  select * into v_player from public.players where id = v_sale.player_id for update;
  if v_player.updated_at <> p_expected_player_updated_at then
    raise exception '[stale_edit] This player changed on another device — refresh and try again.';
  end if;
  if v_player.current_team_id is distinct from v_sale.team_id or v_player.status <> 'sold' then
    raise exception '[sale_no_longer_current] This player''s sale state has moved on since this sale.';
  end if;

  select * into v_team from public.teams where id = v_sale.team_id for update;

  update public.auction_sales set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason
  where id = p_sale_id;

  update public.players set status = 'available', current_team_id = null, sale_price = null, sold_at = null
  where id = v_player.id;

  insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, created_by)
  values (v_sale.event_edition_id, v_sale.team_id, 'reversal', v_sale.amount, 'auction_sales', p_sale_id, auth.uid())
  returning id into v_ledger_id;

  update public.auction_sales set reversal_ledger_entry_id = v_ledger_id where id = p_sale_id;

  insert into public.auction_audit_events (
    event_edition_id, kind, player_id, team_id, sale_id, actor_id, before_state, after_state, detail
  ) values (
    v_sale.event_edition_id, 'sale_reversed', v_player.id, v_sale.team_id, p_sale_id, auth.uid(),
    to_jsonb(v_sale), jsonb_build_object('status', 'available'), jsonb_build_object('reason', p_reason)
  );

  perform public.broadcast_live(
    v_sale.event_edition_id, 'auction', 'reversal',
    jsonb_build_object('player_id', v_player.id, 'team_id', v_sale.team_id, 'sale_id', p_sale_id)
  );

  return jsonb_build_object('sale_id', p_sale_id, 'player_id', v_player.id, 'team_id', v_sale.team_id);
end;
$$;

comment on function public.reverse_sale(uuid, text, timestamptz) is
  'AUC-17..20, AT-AUC-04. Takes a specific p_sale_id, not "reverse latest" '
  '— this is what makes "reverse ANY prior sale" concrete. A genuine error '
  'on double-invoke ([already_reversed]), not a silent no-op — §24.4''s '
  '"make destructive/corrective actions explicit" argues for this '
  'asymmetry vs. e.g. submit_quiz_attempt''s idempotent design.';

create or replace function public.set_active_player(
  p_player_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player_id for update;
  if v_player.id is null then
    raise exception '[not_found] Player not found.';
  end if;
  if v_player.updated_at <> p_expected_updated_at then
    raise exception '[stale_edit] This player changed on another device — refresh and try again.';
  end if;
  if v_player.status not in ('available', 'recalled') then
    raise exception '[invalid_transition] Only an available or recalled player can be made active.';
  end if;

  update public.players set status = 'active' where id = p_player_id;

  insert into public.auction_state (event_edition_id, active_player_id)
  values (v_player.event_edition_id, p_player_id)
  on conflict (event_edition_id) do update set active_player_id = excluded.active_player_id;

  insert into public.auction_audit_events (event_edition_id, kind, player_id, actor_id, before_state, after_state)
  values (v_player.event_edition_id, 'player_activated', p_player_id, auth.uid(),
          to_jsonb(v_player), jsonb_build_object('status', 'active'));

  perform public.broadcast_live(v_player.event_edition_id, 'auction', 'player_activated',
    jsonb_build_object('player_id', p_player_id));

  return jsonb_build_object('player_id', p_player_id);
end;
$$;

create or replace function public.mark_player_unsold(
  p_player_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player_id for update;
  if v_player.id is null then
    raise exception '[not_found] Player not found.';
  end if;
  if v_player.updated_at <> p_expected_updated_at then
    raise exception '[stale_edit] This player changed on another device — refresh and try again.';
  end if;
  if v_player.status not in ('available', 'active') then
    raise exception '[invalid_transition] Only an available or active player can be marked unsold.';
  end if;

  update public.players set status = 'unsold' where id = p_player_id;

  insert into public.auction_audit_events (event_edition_id, kind, player_id, actor_id, before_state, after_state)
  values (v_player.event_edition_id, 'player_unsold', p_player_id, auth.uid(),
          to_jsonb(v_player), jsonb_build_object('status', 'unsold'));

  perform public.broadcast_live(v_player.event_edition_id, 'auction', 'player_unsold',
    jsonb_build_object('player_id', p_player_id));

  return jsonb_build_object('player_id', p_player_id);
end;
$$;

create or replace function public.recall_player(
  p_player_id uuid,
  p_new_pool text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player_id for update;
  if v_player.id is null then
    raise exception '[not_found] Player not found.';
  end if;
  if v_player.updated_at <> p_expected_updated_at then
    raise exception '[stale_edit] This player changed on another device — refresh and try again.';
  end if;
  if v_player.status <> 'unsold' then
    raise exception '[invalid_transition] Only an unsold player can be recalled.';
  end if;

  update public.players set status = 'recalled', pool = coalesce(p_new_pool, pool) where id = p_player_id;

  insert into public.auction_audit_events (event_edition_id, kind, player_id, actor_id, before_state, after_state)
  values (v_player.event_edition_id, 'player_recalled', p_player_id, auth.uid(),
          to_jsonb(v_player), jsonb_build_object('status', 'recalled', 'pool', coalesce(p_new_pool, v_player.pool)));

  perform public.broadcast_live(v_player.event_edition_id, 'auction', 'player_recalled',
    jsonb_build_object('player_id', p_player_id));

  return jsonb_build_object('player_id', p_player_id);
end;
$$;

comment on function public.recall_player(uuid, text, timestamptz) is
  'AUC-06: reopen any unsold player for a later pool. unsold -> recalled '
  'only — re-selling goes through set_active_player()/record_sale() again.';

create or replace function public.end_auction(p_event_edition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.auction_state set ended_at = now(), ended_by = auth.uid()
  where event_edition_id = p_event_edition_id and ended_at is null;

  insert into public.auction_audit_events (event_edition_id, kind, actor_id)
  values (p_event_edition_id, 'auction_ended', auth.uid());

  perform public.broadcast_live(p_event_edition_id, 'auction', 'auction_ended', '{}'::jsonb);
end;
$$;

comment on function public.end_auction(uuid) is
  'LIVE-08: idempotent via "where ended_at is null" — a second call is a '
  'safe no-op, not an error.';

-- ---------------------------------------------------------------------------
-- Grants — every mutating RPC above, revoked from public/anon/authenticated
-- and granted to service_role only. Supabase's ALTER DEFAULT PRIVILEGES
-- grants EXECUTE to anon/authenticated directly on every new function, so
-- "revoke ... from public" alone is not enough.
-- ---------------------------------------------------------------------------

revoke all on function public.admin_grant_starting_purses(uuid) from public, anon, authenticated;
grant execute on function public.admin_grant_starting_purses(uuid) to service_role;

revoke all on function public.admin_apply_pending_simulation_rewards() from public, anon, authenticated;
grant execute on function public.admin_apply_pending_simulation_rewards() to service_role;

revoke all on function public.admin_import_players(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_import_players(uuid, uuid, jsonb) to service_role;

revoke all on function public.admin_upsert_player(uuid, timestamptz, uuid, uuid, text, text, numeric, text, text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_upsert_player(uuid, timestamptz, uuid, uuid, text, text, numeric, text, text, boolean, text, jsonb) to service_role;

revoke all on function public.admin_save_auction_rule_set(uuid, timestamptz, uuid, uuid, numeric, int, int, int, jsonb, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.admin_save_auction_rule_set(uuid, timestamptz, uuid, uuid, numeric, int, int, int, jsonb, jsonb, numeric) to service_role;

revoke all on function public.acquire_record_lock(text, uuid, text) from public, anon, authenticated;
grant execute on function public.acquire_record_lock(text, uuid, text) to service_role;

revoke all on function public.heartbeat_record_lock(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.heartbeat_record_lock(text, uuid, uuid) to service_role;

revoke all on function public.release_record_lock(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_record_lock(text, uuid, uuid) to service_role;

revoke all on function public.record_sale(uuid, uuid, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, numeric, timestamptz) to service_role;

revoke all on function public.reverse_sale(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.reverse_sale(uuid, text, timestamptz) to service_role;

revoke all on function public.set_active_player(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.set_active_player(uuid, timestamptz) to service_role;

revoke all on function public.mark_player_unsold(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_player_unsold(uuid, timestamptz) to service_role;

revoke all on function public.recall_player(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.recall_player(uuid, text, timestamptz) to service_role;

revoke all on function public.end_auction(uuid) from public, anon, authenticated;
grant execute on function public.end_auction(uuid) to service_role;

-- broadcast_live() is only ever called from inside other SECURITY DEFINER
-- functions above (never directly by a client) but still needs the same
-- explicit revoke+grant hygiene as every other function in this migration.
revoke all on function public.broadcast_live(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.broadcast_live(uuid, text, text, jsonb) to service_role;

-- Migration — the trade block. Two franchises swap squad players and cash in
-- one atomic, reversible, audited move.
--
-- Nothing downstream needs to learn about trades. Every roster surface in the
-- app (the six-across squad board on /live, /admin/auction/tracker and each
-- team dashboard; the console's compliance summary; the analytics module;
-- final results) derives a squad from `players.current_team_id where status =
-- 'sold'`, and every purse figure derives from `sum(purse_ledger.amount)`.
-- Move those two things and the whole auction follows — which is exactly why
-- this migration adds a ledger entry_kind and moves current_team_id rather
-- than inventing a parallel notion of ownership.
--
-- What a trade deliberately does NOT touch:
--   * `auction_sales` — the immutable record of what was bought at the
--     auction, by whom, for how much. A trade is a later, separate event; the
--     sales log and public_sales_feed should keep naming the original buyer.
--   * `players.sale_price` — still the price the player fetched under the
--     hammer. It is what the squad board prints next to a name, and detaching
--     it from the auction_sales row it mirrors would make the two disagree.
--     Consequence, stated plainly: `summariseRosters().spend` is "auction
--     value of this squad", not "cash this franchise has spent". The purse
--     ledger is the authority on cash, and it *is* adjusted here.
--   * `players.status` — a traded player is still 'sold', just to someone else.
--
-- Rule enforcement mirrors record_sale exactly (purse floor, max squad size,
-- overseas cap, role caps, pool caps) but evaluates the *net* post-trade state
-- of both franchises, because a two-for-one leaves one squad smaller and the
-- other larger and only the end state is meaningful.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Ledger + audit vocabulary
-- ---------------------------------------------------------------------------

-- 'trade' joins the signed-amount ledger alongside 'purchase'/'sim_bonus'/…
-- A reversal of a trade reuses the existing 'reversal' kind, distinguished by
-- ref_kind = 'auction_trades' — the same shape sale reversals already use.
alter table public.purse_ledger
  drop constraint purse_ledger_entry_kind_check;

alter table public.purse_ledger
  add constraint purse_ledger_entry_kind_check
  check (entry_kind in (
    'start', 'sim_bonus', 'purchase', 'reversal', 'analytics', 'adjustment', 'trade'
  ));

alter table public.auction_audit_events
  drop constraint auction_audit_events_kind_check;

alter table public.auction_audit_events
  add constraint auction_audit_events_kind_check
  check (kind in (
    'player_imported', 'player_edited', 'player_activated', 'player_sold', 'player_unsold',
    'player_recalled', 'sale_reversed', 'rule_set_saved', 'auction_started', 'auction_ended',
    'simulation_purse_applied', 'trade_executed', 'trade_reversed'
  ));

-- ---------------------------------------------------------------------------
-- Trades
-- ---------------------------------------------------------------------------

create table public.auction_trades (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  team_a_id uuid not null references public.teams (id) on delete cascade,
  team_b_id uuid not null references public.teams (id) on delete cascade,
  -- Both non-negative and recorded per direction rather than as one signed
  -- number, so the tab can show the deal the way it was struck ("A sends
  -- 2cr, B sends 0.5cr") even though the ledger only ever sees the net.
  cash_a_to_b numeric(14, 2) not null default 0 check (cash_a_to_b >= 0),
  cash_b_to_a numeric(14, 2) not null default 0 check (cash_b_to_a >= 0),
  memo text,
  executed_at timestamptz not null default now(),
  executed_by uuid references auth.users (id),
  reversed_at timestamptz,
  reversed_by uuid references auth.users (id),
  reversal_reason text,
  created_at timestamptz not null default now(),
  constraint auction_trades_distinct_teams check (team_a_id <> team_b_id)
);

comment on table public.auction_trades is
  'Header row for one two-way trade. The players moved are in '
  'auction_trade_players; the cash shows up in purse_ledger as one net '
  '''trade'' entry per franchise (ref_kind = ''auction_trades'').';

create index auction_trades_event_edition_executed_at_idx
  on public.auction_trades (event_edition_id, executed_at desc);
create index auction_trades_team_a_id_idx on public.auction_trades (team_a_id);
create index auction_trades_team_b_id_idx on public.auction_trades (team_b_id);

create table public.auction_trade_players (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.auction_trades (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  from_team_id uuid not null references public.teams (id) on delete cascade,
  to_team_id uuid not null references public.teams (id) on delete cascade,
  -- Snapshotted so a reversal restores exactly what was there, and so the
  -- trade reads correctly years later even if the player row is edited.
  price_at_trade numeric(14, 2),
  created_at timestamptz not null default now(),
  constraint auction_trade_players_one_per_trade unique (trade_id, player_id),
  constraint auction_trade_players_distinct_teams check (from_team_id <> to_team_id)
);

comment on table public.auction_trade_players is
  'One row per player leg. from_team_id/to_team_id are stored explicitly '
  'rather than derived from the header''s a/b columns so a leg is readable '
  'on its own, and so a reversal never has to reason about which side of the '
  'header a player was on.';

create index auction_trade_players_player_id_idx on public.auction_trade_players (player_id);
create index auction_trade_players_trade_id_idx on public.auction_trade_players (trade_id);

alter table public.auction_trades enable row level security;
alter table public.auction_trade_players enable row level security;

-- A trade is as public as a sale: both franchises' squads visibly change on
-- /live, so hiding the record would only make the board look wrong. Read-only
-- to everyone; writes go exclusively through the two RPCs below.
create policy "auction_trades_select_all"
  on public.auction_trades for select
  to anon, authenticated
  using (true);

create policy "auction_trade_players_select_all"
  on public.auction_trade_players for select
  to anon, authenticated
  using (true);

-- Deliberately no insert/update/delete policy for any client role.

-- ---------------------------------------------------------------------------
-- Trade engine
-- ---------------------------------------------------------------------------

/**
 * Collects rule violations for one franchise's post-trade state.
 *
 * Shared by execute_trade and reverse_trade so the two can never drift on
 * what "legal squad" means, and written against the *already-updated* rows —
 * caller moves the players first, then asks. Returns a jsonb array in the same
 * shape record_sale's [sale_blocked] detail uses, so the console's existing
 * humanizeViolation() renders it without changes.
 */
create or replace function public.auction_squad_violations(
  p_team_id uuid,
  p_rule_set_id uuid
)
returns jsonb
language plpgsql
-- Volatile on purpose. It only reads, but its callers invoke it *after* their
-- own UPDATEs in the same transaction, and a volatile function is guaranteed a
-- fresh snapshot rather than depending on how the planner treats a stable one.
security definer
set search_path = ''
as $$
declare
  v_rule_set public.auction_rule_sets;
  v_team_name text;
  v_violations jsonb := '[]'::jsonb;
  v_balance numeric;
  v_squad_size int;
  v_overseas int;
  v_row record;
  v_max int;
begin
  select * into v_rule_set from public.auction_rule_sets where id = p_rule_set_id;
  if v_rule_set.id is null then
    raise exception '[not_found] Auction rule set not found.';
  end if;

  select name into v_team_name from public.teams where id = p_team_id;

  select coalesce(sum(amount), 0) into v_balance
  from public.purse_ledger where team_id = p_team_id;

  if v_balance < 0 then
    v_violations := v_violations || jsonb_build_object(
      'rule', 'insufficient_purse', 'team', v_team_name, 'balance', v_balance
    );
  end if;

  select
    count(*),
    count(*) filter (where is_overseas)
  into v_squad_size, v_overseas
  from public.players
  where current_team_id = p_team_id and status = 'sold';

  if v_squad_size > v_rule_set.max_squad_size then
    v_violations := v_violations || jsonb_build_object(
      'rule', 'squad_size_exceeded', 'team', v_team_name,
      'size', v_squad_size, 'max', v_rule_set.max_squad_size
    );
  end if;

  if v_overseas > v_rule_set.max_overseas then
    v_violations := v_violations || jsonb_build_object(
      'rule', 'overseas_cap_exceeded', 'team', v_team_name,
      'count', v_overseas, 'max', v_rule_set.max_overseas
    );
  end if;

  -- Only roles/pools the team actually holds can be over cap, so group rather
  -- than iterating the whole limits object.
  for v_row in
    select role, count(*) as n from public.players
    where current_team_id = p_team_id and status = 'sold'
    group by role
  loop
    v_max := (v_rule_set.role_limits -> v_row.role ->> 'max')::int;
    if v_max is not null and v_row.n > v_max then
      v_violations := v_violations || jsonb_build_object(
        'rule', 'role_cap_exceeded', 'team', v_team_name,
        'role', v_row.role, 'count', v_row.n, 'max', v_max
      );
    end if;
  end loop;

  for v_row in
    select pool, count(*) as n from public.players
    where current_team_id = p_team_id and status = 'sold'
    group by pool
  loop
    v_max := (v_rule_set.pool_limits -> v_row.pool ->> 'max')::int;
    if v_max is not null and v_row.n > v_max then
      v_violations := v_violations || jsonb_build_object(
        'rule', 'pool_cap_exceeded', 'team', v_team_name,
        'pool', v_row.pool, 'count', v_row.n, 'max', v_max
      );
    end if;
  end loop;

  return v_violations;
end;
$$;

comment on function public.auction_squad_violations(uuid, uuid) is
  'Rule check over a franchise''s CURRENT squad state — the net-state twin of '
  'record_sale''s per-sale checks, used by execute_trade/reverse_trade after '
  'the moves are applied. Same violation shape as [sale_blocked]''s detail.';

/**
 * One trade, one transaction.
 *
 * Players move by `current_team_id`; cash moves as one net purse_ledger entry
 * per franchise. Both directions are optional — a pure cash deal or a pure
 * player swap are both valid — but a trade that moves nothing is rejected
 * rather than silently recorded.
 *
 * Rules are checked *after* the moves land, then the exception rolls the whole
 * thing back. That ordering is what makes a two-for-one legal: checking each
 * incoming player against the cap one at a time (as record_sale must, since it
 * has nothing to offset against) would reject a swap that leaves the squad the
 * same size it started.
 */
create or replace function public.execute_trade(
  p_event_edition_id uuid,
  p_team_a_id uuid,
  p_team_b_id uuid,
  p_players_a_to_b uuid[],
  p_players_b_to_a uuid[],
  p_cash_a_to_b numeric,
  p_cash_b_to_a numeric,
  p_memo text,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_a public.teams;
  v_team_b public.teams;
  v_rule_set public.auction_rule_sets;
  v_trade_id uuid;
  v_player public.players;
  v_player_id uuid;
  v_cash_a numeric := coalesce(p_cash_a_to_b, 0);
  v_cash_b numeric := coalesce(p_cash_b_to_a, 0);
  v_a_to_b uuid[] := coalesce(p_players_a_to_b, '{}'::uuid[]);
  v_b_to_a uuid[] := coalesce(p_players_b_to_a, '{}'::uuid[]);
  v_net_a numeric;
  v_net_b numeric;
  v_violations jsonb;
  v_memo text;
begin
  perform public.assert_admin(p_admin_id);

  if p_team_a_id = p_team_b_id then
    raise exception '[invalid_trade] A franchise cannot trade with itself.';
  end if;
  if v_cash_a < 0 or v_cash_b < 0 then
    raise exception '[invalid_trade] Cash amounts cannot be negative.';
  end if;
  if array_length(v_a_to_b, 1) is null and array_length(v_b_to_a, 1) is null
     and v_cash_a = 0 and v_cash_b = 0 then
    raise exception '[invalid_trade] A trade must move at least one player or some cash.';
  end if;
  if v_a_to_b && v_b_to_a then
    raise exception '[invalid_trade] The same player cannot move in both directions.';
  end if;

  -- Locked in id order: two admins striking reciprocal trades on the same
  -- pair of franchises would otherwise be a textbook deadlock.
  if p_team_a_id < p_team_b_id then
    select * into v_team_a from public.teams where id = p_team_a_id for update;
    select * into v_team_b from public.teams where id = p_team_b_id for update;
  else
    select * into v_team_b from public.teams where id = p_team_b_id for update;
    select * into v_team_a from public.teams where id = p_team_a_id for update;
  end if;

  if v_team_a.id is null or v_team_b.id is null then
    raise exception '[not_found] Franchise not found.';
  end if;
  if v_team_a.event_edition_id <> p_event_edition_id or v_team_b.event_edition_id <> p_event_edition_id then
    raise exception '[invalid_trade] Both franchises must belong to this event edition.';
  end if;
  if v_team_a.status <> 'active' or v_team_b.status <> 'active' then
    raise exception '[team_not_eligible] Both franchises must be active.';
  end if;

  select * into v_rule_set from public.auction_rule_sets
  where event_edition_id = p_event_edition_id and is_active;
  if v_rule_set.id is null then
    raise exception '[not_found] No active auction rule set.';
  end if;

  insert into public.auction_trades (
    event_edition_id, team_a_id, team_b_id, cash_a_to_b, cash_b_to_a, memo, executed_by
  ) values (
    p_event_edition_id, p_team_a_id, p_team_b_id, v_cash_a, v_cash_b, nullif(btrim(coalesce(p_memo, '')), ''), p_admin_id
  )
  returning id into v_trade_id;

  -- A -> B
  foreach v_player_id in array v_a_to_b loop
    select * into v_player from public.players where id = v_player_id for update;
    if v_player.id is null then
      raise exception '[not_found] Player % not found.', v_player_id;
    end if;
    if v_player.status <> 'sold' or v_player.current_team_id is distinct from p_team_a_id then
      raise exception '[player_not_on_roster] % is not currently on %''s squad.',
        v_player.full_name, v_team_a.name;
    end if;
    update public.players set current_team_id = p_team_b_id where id = v_player_id;
    insert into public.auction_trade_players (trade_id, player_id, from_team_id, to_team_id, price_at_trade)
    values (v_trade_id, v_player_id, p_team_a_id, p_team_b_id, v_player.sale_price);
  end loop;

  -- B -> A
  foreach v_player_id in array v_b_to_a loop
    select * into v_player from public.players where id = v_player_id for update;
    if v_player.id is null then
      raise exception '[not_found] Player % not found.', v_player_id;
    end if;
    if v_player.status <> 'sold' or v_player.current_team_id is distinct from p_team_b_id then
      raise exception '[player_not_on_roster] % is not currently on %''s squad.',
        v_player.full_name, v_team_b.name;
    end if;
    update public.players set current_team_id = p_team_a_id where id = v_player_id;
    insert into public.auction_trade_players (trade_id, player_id, from_team_id, to_team_id, price_at_trade)
    values (v_trade_id, v_player_id, p_team_b_id, p_team_a_id, v_player.sale_price);
  end loop;

  -- Cash: net per franchise. Two rows for one franchise would be noise in a
  -- ledger whose amount column is already signed.
  v_net_a := v_cash_b - v_cash_a;
  v_net_b := v_cash_a - v_cash_b;
  v_memo := format('Trade %s <-> %s', v_team_a.name, v_team_b.name);

  if v_net_a <> 0 then
    insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, memo, created_by)
    values (p_event_edition_id, p_team_a_id, 'trade', v_net_a, 'auction_trades', v_trade_id, v_memo, p_admin_id);
  end if;
  if v_net_b <> 0 then
    insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, memo, created_by)
    values (p_event_edition_id, p_team_b_id, 'trade', v_net_b, 'auction_trades', v_trade_id, v_memo, p_admin_id);
  end if;

  -- Now that both squads and both purses are at their post-trade state.
  v_violations := public.auction_squad_violations(p_team_a_id, v_rule_set.id)
                || public.auction_squad_violations(p_team_b_id, v_rule_set.id);

  if jsonb_array_length(v_violations) > 0 then
    raise exception '[trade_blocked] % rule(s) violated.', jsonb_array_length(v_violations)
      using detail = v_violations::text;
  end if;

  insert into public.auction_audit_events (
    event_edition_id, kind, team_id, actor_id, after_state, detail
  ) values (
    p_event_edition_id, 'trade_executed', p_team_a_id, p_admin_id,
    jsonb_build_object('trade_id', v_trade_id),
    jsonb_build_object(
      'team_a_id', p_team_a_id, 'team_b_id', p_team_b_id,
      'players_a_to_b', to_jsonb(v_a_to_b), 'players_b_to_a', to_jsonb(v_b_to_a),
      'cash_a_to_b', v_cash_a, 'cash_b_to_a', v_cash_b, 'memo', p_memo
    )
  );

  perform public.log_activity(
    p_event_edition_id, null, 'admin', 'trade_executed',
    jsonb_build_object('trade_id', v_trade_id, 'team_a_id', p_team_a_id, 'team_b_id', p_team_b_id)
  );

  -- Same topic the console, tracker, /live and every team dashboard already
  -- listen on, so all four repaint without knowing what a trade is.
  perform public.broadcast_live(
    p_event_edition_id, 'auction', 'trade',
    jsonb_build_object('trade_id', v_trade_id, 'team_a_id', p_team_a_id, 'team_b_id', p_team_b_id)
  );

  return jsonb_build_object('trade_id', v_trade_id);
end;
$$;

comment on function public.execute_trade(uuid, uuid, uuid, uuid[], uuid[], numeric, numeric, text, uuid) is
  'The trade block. Moves players via players.current_team_id and cash via one '
  'net ''trade'' purse_ledger entry per franchise, then validates the '
  'resulting squads against the active rule set (net state, not per-player) '
  'and rolls back on [trade_blocked]. Reversible via reverse_trade().';

/**
 * Undo a trade by putting every player back and posting compensating ledger
 * entries — never by deleting rows. Same contract as reverse_sale: the ledger
 * is append-only, so "undo" means "equal and opposite".
 *
 * Refuses if any traded player has moved on since (sold elsewhere, reversed,
 * or traded again), because silently yanking them out of a third franchise's
 * squad is worse than making the admin unwind in order.
 */
create or replace function public.reverse_trade(
  p_trade_id uuid,
  p_reason text,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trade public.auction_trades;
  v_rule_set public.auction_rule_sets;
  v_leg record;
  v_player public.players;
  v_ledger record;
  v_violations jsonb;
begin
  perform public.assert_admin(p_admin_id);

  select * into v_trade from public.auction_trades where id = p_trade_id for update;
  if v_trade.id is null then
    raise exception '[not_found] Trade not found.';
  end if;
  if v_trade.reversed_at is not null then
    raise exception '[already_reversed] This trade was already reversed.';
  end if;

  select * into v_rule_set from public.auction_rule_sets
  where event_edition_id = v_trade.event_edition_id and is_active;
  if v_rule_set.id is null then
    raise exception '[not_found] No active auction rule set.';
  end if;

  if v_trade.team_a_id < v_trade.team_b_id then
    perform 1 from public.teams where id = v_trade.team_a_id for update;
    perform 1 from public.teams where id = v_trade.team_b_id for update;
  else
    perform 1 from public.teams where id = v_trade.team_b_id for update;
    perform 1 from public.teams where id = v_trade.team_a_id for update;
  end if;

  for v_leg in
    select * from public.auction_trade_players where trade_id = p_trade_id order by created_at
  loop
    select * into v_player from public.players where id = v_leg.player_id for update;
    if v_player.id is null then
      raise exception '[not_found] A player from this trade no longer exists.';
    end if;
    if v_player.status <> 'sold' or v_player.current_team_id is distinct from v_leg.to_team_id then
      raise exception
        '[trade_no_longer_current] %''s squad has moved on since this trade — unwind the later change first.',
        v_player.full_name;
    end if;
    update public.players set current_team_id = v_leg.from_team_id where id = v_leg.player_id;
  end loop;

  -- Mirror each cash entry this trade posted, whichever franchises they were
  -- for — reading them back beats recomputing the net a second time.
  for v_ledger in
    select team_id, amount from public.purse_ledger
    where ref_kind = 'auction_trades' and ref_id = p_trade_id and entry_kind = 'trade'
  loop
    insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, memo, created_by)
    values (
      v_trade.event_edition_id, v_ledger.team_id, 'reversal', -v_ledger.amount,
      'auction_trades', p_trade_id, 'Trade reversed', p_admin_id
    );
  end loop;

  update public.auction_trades
  set reversed_at = now(), reversed_by = p_admin_id, reversal_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_trade_id;

  -- Unwinding restores an earlier legal state, so this should never fire —
  -- but a rule set edited between the trade and its reversal could make it,
  -- and a silent illegal squad is worse than a refusal.
  v_violations := public.auction_squad_violations(v_trade.team_a_id, v_rule_set.id)
                || public.auction_squad_violations(v_trade.team_b_id, v_rule_set.id);
  if jsonb_array_length(v_violations) > 0 then
    raise exception '[trade_blocked] Reversing this trade would leave % rule(s) violated.',
      jsonb_array_length(v_violations)
      using detail = v_violations::text;
  end if;

  insert into public.auction_audit_events (
    event_edition_id, kind, team_id, actor_id, before_state, after_state, detail
  ) values (
    v_trade.event_edition_id, 'trade_reversed', v_trade.team_a_id, p_admin_id,
    to_jsonb(v_trade), jsonb_build_object('reversed', true),
    jsonb_build_object('trade_id', p_trade_id, 'reason', p_reason)
  );

  perform public.log_activity(
    v_trade.event_edition_id, null, 'admin', 'trade_reversed',
    jsonb_build_object('trade_id', p_trade_id)
  );

  perform public.broadcast_live(
    v_trade.event_edition_id, 'auction', 'trade_reversed',
    jsonb_build_object('trade_id', p_trade_id, 'team_a_id', v_trade.team_a_id, 'team_b_id', v_trade.team_b_id)
  );

  return jsonb_build_object('trade_id', p_trade_id);
end;
$$;

comment on function public.reverse_trade(uuid, text, uuid) is
  'Compensating undo for execute_trade: players back to from_team_id, equal '
  'and opposite ''reversal'' ledger entries. Refuses if any traded player has '
  'since moved again ([trade_no_longer_current]).';

revoke all on function public.auction_squad_violations(uuid, uuid) from public, anon, authenticated;
grant execute on function public.auction_squad_violations(uuid, uuid) to service_role;

revoke all on function public.execute_trade(uuid, uuid, uuid, uuid[], uuid[], numeric, numeric, text, uuid)
  from public, anon, authenticated;
grant execute on function public.execute_trade(uuid, uuid, uuid, uuid[], uuid[], numeric, numeric, text, uuid)
  to service_role;

revoke all on function public.reverse_trade(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.reverse_trade(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Public read surface
-- ---------------------------------------------------------------------------

-- Curated like public_sales_feed (deliberately not security_invoker — column
-- curation that must bypass teams' row-level RLS so teams.captain_email can
-- never leak through a view that merely didn't select it).
create view public.public_trades_feed as
select
  tr.id,
  tr.event_edition_id,
  tr.team_a_id,
  ta.name as team_a_name,
  tr.team_b_id,
  tb.name as team_b_name,
  tr.cash_a_to_b,
  tr.cash_b_to_a,
  tr.memo,
  tr.executed_at,
  tr.reversed_at,
  tr.reversal_reason
from public.auction_trades tr
join public.teams ta on ta.id = tr.team_a_id
join public.teams tb on tb.id = tr.team_b_id;

grant select on public.public_trades_feed to anon, authenticated;

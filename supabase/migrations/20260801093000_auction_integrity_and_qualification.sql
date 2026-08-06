-- Migration — Auction integrity & qualification enforcement (audit P0 #2, #3)
--
-- #2: can_team_submit() (migration 004) is the only place stage
-- qualification was ever enforced. admin_grant_starting_purses,
-- record_sale, submit_simulation_attempt and request_analytics all checked
-- only teams.status = 'active', so a team that failed to qualify from an
-- earlier stage could still reach the auction/simulation/analytics. This
-- migration extracts the qualification check from can_team_submit() into
-- a reusable helper and calls it from every one of those RPCs wherever a
-- round_id is in scope (absent round_id/requires_qualification_from_stage
-- means "no gate", identical to can_team_submit()'s existing semantics).
--
-- #3: record_sale/reverse_sale/set_active_player/mark_player_unsold/
-- recall_player never checked auction_state.ended_at — only the admin
-- console UI disabled its buttons once the auction ended. This migration
-- adds that guard to all five.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- #2a. Reusable qualification check, extracted from can_team_submit().
-- Internal helper only (never called directly by a client) — same
-- revoke/grant hygiene as broadcast_live() (migration 006).
-- ---------------------------------------------------------------------------

create or replace function public.team_meets_stage_requirement(p_round_id uuid, p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_decision text;
begin
  if p_round_id is null then
    return true;
  end if;

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.id is null or v_round.requires_qualification_from_stage is null then
    return true;
  end if;

  select decision into v_decision
  from public.qualifications
  where stage_id = v_round.requires_qualification_from_stage and team_id = p_team_id;

  -- coalesce, not a bare `=`: v_decision is null when no qualifications row
  -- exists yet, and `null = 'qualified'` evaluates to NULL — which a
  -- `not ...` guard in a calling RPC treats as "don't raise" (NULL is not
  -- true), silently letting an unqualified team through. Must be an
  -- explicit false, matching can_team_submit()'s original `is distinct
  -- from` check this function replaced.
  return coalesce(v_decision = 'qualified', false);
end;
$$;

comment on function public.team_meets_stage_requirement(uuid, uuid) is
  'Extracted from can_team_submit() (migration 004) so auction/simulation/'
  'analytics RPCs can share the exact same qualification semantics instead '
  'of re-implementing the "no gate configured" vs "must be qualified" '
  'branch independently (audit P0 #2).';

revoke all on function public.team_meets_stage_requirement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.team_meets_stage_requirement(uuid, uuid) to service_role;

-- can_team_submit() itself, rewritten to call the shared helper —
-- behavior-neutral (same branches, same order), covered by the existing
-- rounds.test.ts submission-eligibility tests.
create or replace function public.can_team_submit(p_round_id uuid, p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_team_status text;
begin
  if p_team_id <> (select auth.uid()) and not public.is_admin() then
    return false;
  end if;

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.id is null then
    return false;
  end if;

  select status into v_team_status from public.teams where id = p_team_id;
  if v_team_status is distinct from 'active' then
    return false;
  end if;

  if public.effective_round_status(v_round) <> 'open' then
    return false;
  end if;

  if not public.team_meets_stage_requirement(p_round_id, p_team_id) then
    return false;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- #2b. Qualification enforcement in the four RPCs the audit named.
-- ---------------------------------------------------------------------------

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
    if not public.team_meets_stage_requirement(v_rule_set.round_id, v_team.id) then
      continue;
    end if;

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

comment on function public.admin_grant_starting_purses(uuid) is
  'Skips (rather than errors on) a team that has not met the active rule '
  'set''s round qualification requirement — this runs over every active '
  'team at once, so one unqualified team should not abort the grant for '
  'everyone else (audit P0 #2).';

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

  if exists (
    select 1 from public.auction_state
    where event_edition_id = v_player.event_edition_id and ended_at is not null
  ) then
    raise exception '[auction_ended] The auction has ended; no further sales can be recorded.';
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

  if not public.team_meets_stage_requirement(v_player.round_id, p_team_id) then
    raise exception '[team_not_qualified] Team has not qualified for this round.';
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
  'exception''s DETAIL (not just the first) — see the [sale_blocked] raise. '
  'Also enforces auction_state.ended_at (audit P0 #3) and stage '
  'qualification (audit P0 #2).';

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

  if exists (
    select 1 from public.auction_state
    where event_edition_id = v_sale.event_edition_id and ended_at is not null
  ) then
    raise exception '[auction_ended] The auction has ended; sales can no longer be reversed.';
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
  'asymmetry vs. e.g. submit_quiz_attempt''s idempotent design. Also '
  'enforces auction_state.ended_at (audit P0 #3).';

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

  if exists (
    select 1 from public.auction_state
    where event_edition_id = v_player.event_edition_id and ended_at is not null
  ) then
    raise exception '[auction_ended] The auction has ended; no further player activations are allowed.';
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

  if exists (
    select 1 from public.auction_state
    where event_edition_id = v_player.event_edition_id and ended_at is not null
  ) then
    raise exception '[auction_ended] The auction has ended; players can no longer be marked unsold.';
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

  if exists (
    select 1 from public.auction_state
    where event_edition_id = v_player.event_edition_id and ended_at is not null
  ) then
    raise exception '[auction_ended] The auction has ended; players can no longer be recalled.';
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
  'only — re-selling goes through set_active_player()/record_sale() again. '
  'Also enforces auction_state.ended_at (audit P0 #3).';

-- ---------------------------------------------------------------------------
-- #2c. Qualification enforcement in simulation and analytics.
-- ---------------------------------------------------------------------------

create or replace function public.submit_simulation_attempt(
  p_team_id uuid,
  p_config_id uuid,
  p_parameters jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.simulation_config;
  v_last_attempt timestamptz;
  v_eval jsonb;
  v_winner_rank int;
  v_attempt_id uuid;
begin
  select * into v_config from public.simulation_config where id = p_config_id for update;
  if v_config.id is null then
    raise exception '[not_found] Simulation config not found.';
  end if;

  if not public.team_meets_stage_requirement(v_config.round_id, p_team_id) then
    raise exception '[team_not_qualified] Team has not qualified for this round.';
  end if;

  if v_config.started_at is null then
    raise exception '[simulation_not_started] The simulation has not started yet.';
  end if;
  if v_config.stopped_at is not null then
    raise exception '[simulation_stopped] The simulation has been stopped.';
  end if;
  if now() >= v_config.started_at + make_interval(secs => v_config.global_timer_seconds) then
    raise exception '[simulation_timer_expired] The simulation timer has expired.';
  end if;
  if v_config.winner_count >= 2 then
    raise exception '[simulation_already_won] Two winners have already been confirmed.';
  end if;
  if v_config.defaults_overall <> 70 then
    raise exception '[simulation_config_invalid] This simulation''s configuration failed calibration.';
  end if;

  select server_ts into v_last_attempt
  from public.simulation_attempts
  where config_id = p_config_id and team_id = p_team_id
  order by server_ts desc
  limit 1;

  if v_last_attempt is not null
     and now() < v_last_attempt + make_interval(secs => v_config.submit_cooldown_seconds) then
    raise exception '[submit_cooldown] Please wait before submitting another attempt.';
  end if;

  v_eval := public.simulation_evaluate(v_config, p_parameters);

  if (v_eval ->> 'success')::boolean and v_config.winner_count < 2 then
    v_winner_rank := v_config.winner_count + 1;
    update public.simulation_config set winner_count = winner_count + 1 where id = p_config_id;
  end if;

  insert into public.simulation_attempts
    (config_id, team_id, submitted_parameters, sub_scores, overall, success, winner_rank)
  values (
    p_config_id, p_team_id, p_parameters,
    v_eval -> 'sub_scores', (v_eval ->> 'overall')::numeric, (v_eval ->> 'success')::boolean, v_winner_rank
  )
  returning id into v_attempt_id;

  perform public.log_activity(
    v_config.event_edition_id, p_team_id, 'team', 'simulation_attempt_submitted',
    jsonb_build_object('config_id', p_config_id, 'attempt_id', v_attempt_id, 'success', v_eval ->> 'success')
  );

  -- Never matched_key_index, never a per-parameter breakdown — that
  -- lossiness is the puzzle. Uses `->` (not `->>`) for overall/success so
  -- the jsonb keeps its real number/boolean type — `->>` would silently
  -- turn `false` into the *string* "false", which is truthy in JS.
  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'sub_scores', v_eval -> 'sub_scores',
    'overall', v_eval -> 'overall',
    'success', v_eval -> 'success',
    'winner_rank', v_winner_rank
  );
end;
$$;

comment on function public.submit_simulation_attempt(uuid, uuid, jsonb) is
  'SIM-06/07/08/10: unlimited attempts gated only by a submit cooldown '
  '(anti-spam floor, not an attempt cap) and the global timer. Hard stops '
  'at two winners via the unique partial index plus this row lock. Also '
  'enforces stage qualification against simulation_config.round_id (audit '
  'P0 #2).';

create or replace function public.request_analytics(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_rule_set public.auction_rule_sets;
  v_balance numeric;
  v_existing public.analytics_requests;
begin
  select * into v_team from public.teams where id = p_team_id for update;
  if v_team.id is null then
    raise exception '[not_found] Team not found.';
  end if;

  select * into v_existing from public.analytics_requests
  where team_id = p_team_id and status in ('pending', 'approved')
  order by requested_at desc limit 1;

  if v_existing.id is not null then
    -- Idempotent, like end_auction(): a repeat click just returns the
    -- existing state instead of erroring (AN-06).
    return jsonb_build_object('request_id', v_existing.id, 'status', v_existing.status);
  end if;

  select * into v_rule_set from public.auction_rule_sets
  where event_edition_id = v_team.event_edition_id and is_active;
  if v_rule_set.id is null then
    raise exception '[not_found] No active auction rule set.';
  end if;

  if not public.team_meets_stage_requirement(v_rule_set.round_id, p_team_id) then
    raise exception '[team_not_qualified] Team has not qualified for this round.';
  end if;

  select coalesce(sum(amount), 0) into v_balance
  from public.purse_ledger where team_id = p_team_id;

  if v_balance < v_rule_set.analytics_price then
    raise exception '[insufficient_purse] Your purse balance is too low to request analytics.'
      using detail = jsonb_build_object('balance', v_balance, 'price', v_rule_set.analytics_price)::text;
  end if;

  insert into public.analytics_requests (event_edition_id, team_id, price_at_request, requested_by)
  values (v_team.event_edition_id, p_team_id, v_rule_set.analytics_price, auth.uid())
  returning * into v_existing;

  perform public.log_activity(v_team.event_edition_id, p_team_id, 'team', 'analytics_requested',
    jsonb_build_object('request_id', v_existing.id, 'price', v_rule_set.analytics_price));

  perform public.broadcast_live(v_team.event_edition_id, 'analytics', 'requested',
    jsonb_build_object('team_id', p_team_id, 'request_id', v_existing.id));

  return jsonb_build_object('request_id', v_existing.id, 'status', 'pending');
end;
$$;

comment on function public.request_analytics(uuid) is
  'AN-03/AN-06. Idempotent on a repeat call while already pending/approved. '
  'Also enforces stage qualification against the active rule set''s '
  'round_id (audit P0 #2).';

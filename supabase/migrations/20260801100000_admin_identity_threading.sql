-- Migration — Real admin identity threading (audit P0 #4)
--
-- Every mutating RPC in this schema is invoked through createAdminClient()
-- (src/lib/supabase/admin.ts) — a service-role client with no user JWT, so
-- auth.uid() is null for the entire lifetime of that connection. Every
-- admin-attribution column that stamped auth.uid() (sold_by, reversed_by,
-- actor_id, ended_by, locked_by, entered_by, created_by, decided_by,
-- published_by) was therefore silently null in production the whole time —
-- migration 20260730081000 already noticed and worked around this for
-- record_locks.locked_by by making the column nullable, but that papered
-- over the symptom rather than fixing the cause.
--
-- Fix: every affected RPC gains an explicit p_admin_id uuid parameter
-- (appended last, so this is a breaking signature change — old overloads
-- are dropped, not left behind, so a stale caller fails loudly rather than
-- silently hitting a null-attribution function again). Each RPC validates
-- that id via assert_admin() before doing anything else, then stamps it in
-- place of auth.uid(). Every admin server action must now pass
-- `p_admin_id: (await requireAdmin()).id` — requireAdmin() already
-- authenticates and returns that user, so this is additive, not a new
-- auth check (src/lib/require-role.ts).
--
-- request_analytics() is the one exception: it's team-initiated (the
-- caller already passes p_team_id, the requesting team's own id) but also
-- runs through the admin client to bypass RLS for the purse-balance check.
-- Its requested_by fix is simply auth.uid() -> p_team_id, no new parameter.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- assert_admin() — the one new primitive this migration adds. There is no
-- `admins` table in this schema; admin-ness lives only on
-- auth.users.raw_app_meta_data (the same source public.is_admin() reads
-- from the request JWT). A SECURITY DEFINER function can read auth.users
-- directly, so this needs no new table.
-- ---------------------------------------------------------------------------

create or replace function public.assert_admin(p_admin_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_admin_id is null or not exists (
    select 1 from auth.users
    where id = p_admin_id and (raw_app_meta_data ->> 'role') = 'admin'
  ) then
    raise exception '[admin_required] % is not a recognized administrator.', p_admin_id;
  end if;
end;
$$;

comment on function public.assert_admin(uuid) is
  'Validates a client-supplied admin id against auth.users.app_metadata.role '
  '— the same source public.is_admin() reads from the request JWT, just '
  'read directly since service-role RPC calls have no request JWT at all '
  '(audit P0 #4).';

revoke all on function public.assert_admin(uuid) from public, anon, authenticated;
grant execute on function public.assert_admin(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Auction RPCs (migration 006 signatures dropped, re-created with p_admin_id)
-- ---------------------------------------------------------------------------

drop function if exists public.record_sale(uuid, uuid, numeric, timestamptz);
create function public.record_sale(
  p_player_id uuid,
  p_team_id uuid,
  p_amount numeric,
  p_expected_player_updated_at timestamptz,
  p_admin_id uuid
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
  perform public.assert_admin(p_admin_id);

  select * into v_player from public.players where id = p_player_id for update;
  if v_player.id is null then
    raise exception '[not_found] Player not found.';
  end if;

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
  values (v_player.event_edition_id, p_player_id, p_team_id, p_amount, p_admin_id)
  returning id into v_sale_id;

  insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, created_by)
  values (v_player.event_edition_id, p_team_id, 'purchase', -p_amount, 'auction_sales', v_sale_id, p_admin_id)
  returning id into v_ledger_id;

  update public.auction_sales set purse_ledger_entry_id = v_ledger_id where id = v_sale_id;

  insert into public.auction_audit_events (
    event_edition_id, kind, player_id, team_id, sale_id, actor_id, before_state, after_state
  ) values (
    v_player.event_edition_id, 'player_sold', p_player_id, p_team_id, v_sale_id, p_admin_id,
    to_jsonb(v_player), jsonb_build_object('status', 'sold', 'team_id', p_team_id, 'amount', p_amount)
  );

  perform public.broadcast_live(
    v_player.event_edition_id, 'auction', 'sale',
    jsonb_build_object('player_id', p_player_id, 'team_id', p_team_id, 'sale_id', v_sale_id, 'amount', p_amount)
  );

  return jsonb_build_object('sale_id', v_sale_id, 'player_id', p_player_id, 'team_id', p_team_id, 'amount', p_amount);
end;
$$;

comment on function public.record_sale(uuid, uuid, numeric, timestamptz, uuid) is
  'AUC-08..12, AT-AUC-01..03. p_admin_id (audit P0 #4) replaces auth.uid() '
  'for sold_by/purse_ledger.created_by/auction_audit_events.actor_id, '
  'validated via assert_admin().';

revoke all on function public.record_sale(uuid, uuid, numeric, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, numeric, timestamptz, uuid) to service_role;

drop function if exists public.reverse_sale(uuid, text, timestamptz);
create function public.reverse_sale(
  p_sale_id uuid,
  p_reason text,
  p_expected_player_updated_at timestamptz,
  p_admin_id uuid
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
  perform public.assert_admin(p_admin_id);

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

  select * into v_player from public.players where id = v_sale.player_id for update;
  if v_player.updated_at <> p_expected_player_updated_at then
    raise exception '[stale_edit] This player changed on another device — refresh and try again.';
  end if;
  if v_player.current_team_id is distinct from v_sale.team_id or v_player.status <> 'sold' then
    raise exception '[sale_no_longer_current] This player''s sale state has moved on since this sale.';
  end if;

  select * into v_team from public.teams where id = v_sale.team_id for update;

  update public.auction_sales set reversed_at = now(), reversed_by = p_admin_id, reversal_reason = p_reason
  where id = p_sale_id;

  update public.players set status = 'available', current_team_id = null, sale_price = null, sold_at = null
  where id = v_player.id;

  insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, created_by)
  values (v_sale.event_edition_id, v_sale.team_id, 'reversal', v_sale.amount, 'auction_sales', p_sale_id, p_admin_id)
  returning id into v_ledger_id;

  update public.auction_sales set reversal_ledger_entry_id = v_ledger_id where id = p_sale_id;

  insert into public.auction_audit_events (
    event_edition_id, kind, player_id, team_id, sale_id, actor_id, before_state, after_state, detail
  ) values (
    v_sale.event_edition_id, 'sale_reversed', v_player.id, v_sale.team_id, p_sale_id, p_admin_id,
    to_jsonb(v_sale), jsonb_build_object('status', 'available'), jsonb_build_object('reason', p_reason)
  );

  perform public.broadcast_live(
    v_sale.event_edition_id, 'auction', 'reversal',
    jsonb_build_object('player_id', v_player.id, 'team_id', v_sale.team_id, 'sale_id', p_sale_id)
  );

  return jsonb_build_object('sale_id', p_sale_id, 'player_id', v_player.id, 'team_id', v_sale.team_id);
end;
$$;

comment on function public.reverse_sale(uuid, text, timestamptz, uuid) is
  'AUC-17..20, AT-AUC-04. p_admin_id (audit P0 #4) replaces auth.uid() for '
  'reversed_by/purse_ledger.created_by/auction_audit_events.actor_id.';

revoke all on function public.reverse_sale(uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.reverse_sale(uuid, text, timestamptz, uuid) to service_role;

drop function if exists public.set_active_player(uuid, timestamptz);
create function public.set_active_player(
  p_player_id uuid,
  p_expected_updated_at timestamptz,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
begin
  perform public.assert_admin(p_admin_id);

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
  values (v_player.event_edition_id, 'player_activated', p_player_id, p_admin_id,
          to_jsonb(v_player), jsonb_build_object('status', 'active'));

  perform public.broadcast_live(v_player.event_edition_id, 'auction', 'player_activated',
    jsonb_build_object('player_id', p_player_id));

  return jsonb_build_object('player_id', p_player_id);
end;
$$;

revoke all on function public.set_active_player(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.set_active_player(uuid, timestamptz, uuid) to service_role;

drop function if exists public.mark_player_unsold(uuid, timestamptz);
create function public.mark_player_unsold(
  p_player_id uuid,
  p_expected_updated_at timestamptz,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
begin
  perform public.assert_admin(p_admin_id);

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
  values (v_player.event_edition_id, 'player_unsold', p_player_id, p_admin_id,
          to_jsonb(v_player), jsonb_build_object('status', 'unsold'));

  perform public.broadcast_live(v_player.event_edition_id, 'auction', 'player_unsold',
    jsonb_build_object('player_id', p_player_id));

  return jsonb_build_object('player_id', p_player_id);
end;
$$;

revoke all on function public.mark_player_unsold(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.mark_player_unsold(uuid, timestamptz, uuid) to service_role;

drop function if exists public.recall_player(uuid, text, timestamptz);
create function public.recall_player(
  p_player_id uuid,
  p_new_pool text,
  p_expected_updated_at timestamptz,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
begin
  perform public.assert_admin(p_admin_id);

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
  values (v_player.event_edition_id, 'player_recalled', p_player_id, p_admin_id,
          to_jsonb(v_player), jsonb_build_object('status', 'recalled', 'pool', coalesce(p_new_pool, v_player.pool)));

  perform public.broadcast_live(v_player.event_edition_id, 'auction', 'player_recalled',
    jsonb_build_object('player_id', p_player_id));

  return jsonb_build_object('player_id', p_player_id);
end;
$$;

revoke all on function public.recall_player(uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.recall_player(uuid, text, timestamptz, uuid) to service_role;

drop function if exists public.end_auction(uuid);
create function public.end_auction(p_event_edition_id uuid, p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  update public.auction_state set ended_at = now(), ended_by = p_admin_id
  where event_edition_id = p_event_edition_id and ended_at is null;

  insert into public.auction_audit_events (event_edition_id, kind, actor_id)
  values (p_event_edition_id, 'auction_ended', p_admin_id);

  perform public.broadcast_live(p_event_edition_id, 'auction', 'auction_ended', '{}'::jsonb);
end;
$$;

comment on function public.end_auction(uuid, uuid) is
  'LIVE-08: idempotent via "where ended_at is null" — a second call is a '
  'safe no-op, not an error.';

revoke all on function public.end_auction(uuid, uuid) from public, anon, authenticated;
grant execute on function public.end_auction(uuid, uuid) to service_role;

drop function if exists public.admin_grant_starting_purses(uuid);
create function public.admin_grant_starting_purses(p_event_edition_id uuid, p_admin_id uuid)
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
  perform public.assert_admin(p_admin_id);

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
    values (p_event_edition_id, v_team.id, 'start', v_rule_set.starting_purse, p_admin_id)
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

revoke all on function public.admin_grant_starting_purses(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_grant_starting_purses(uuid, uuid) to service_role;

drop function if exists public.acquire_record_lock(text, uuid, text);
create function public.acquire_record_lock(
  p_record_type text,
  p_record_id uuid,
  p_device_label text,
  p_admin_id uuid
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
  perform public.assert_admin(p_admin_id);

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
  values (p_record_type, p_record_id, p_admin_id, p_device_label, v_token)
  on conflict (record_type, record_id) do update set
    locked_by = excluded.locked_by, device_label = excluded.device_label,
    session_token = excluded.session_token, acquired_at = now(), heartbeat_at = now();

  return jsonb_build_object('session_token', v_token, 'ttl_seconds', 20);
end;
$$;

revoke all on function public.acquire_record_lock(text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_record_lock(text, uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Scoring / stage / leaderboard / announcement RPCs (migration 004)
-- ---------------------------------------------------------------------------

drop function if exists public.admin_save_score(uuid, uuid, timestamptz, numeric, numeric, jsonb, text);
create function public.admin_save_score(
  p_round_id uuid,
  p_team_id uuid,
  p_expected_updated_at timestamptz,
  p_total numeric,
  p_max_total numeric,
  p_criterion_values jsonb,
  p_notes text,
  p_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score_id uuid;
  v_actual_updated_at timestamptz;
  v_rubric_mode text;
  v_computed_total numeric;
  v_cv jsonb;
begin
  perform public.assert_admin(p_admin_id);

  select rubric_total_mode into v_rubric_mode from public.rounds where id = p_round_id;
  if v_rubric_mode is null then
    raise exception '[not_found] Round not found.';
  end if;

  select id, updated_at into v_score_id, v_actual_updated_at
  from public.scores where round_id = p_round_id and team_id = p_team_id
  for update;

  if v_score_id is not null and p_expected_updated_at is not null
     and v_actual_updated_at <> p_expected_updated_at then
    raise exception '[stale_edit] This score was edited by someone else — refresh and try again.';
  end if;

  if p_criterion_values is not null and jsonb_array_length(p_criterion_values) > 0 then
    select sum(
      (cv ->> 'value')::numeric *
      case when v_rubric_mode = 'weighted_percent'
        then rc.weight / nullif(rc.max_value, 0)
        else rc.weight
      end
    )
    into v_computed_total
    from jsonb_array_elements(p_criterion_values) cv
    join public.rubric_criteria rc on rc.id = (cv ->> 'criterion_id')::uuid
    where rc.round_id = p_round_id;
  else
    v_computed_total := p_total;
  end if;

  insert into public.scores (round_id, team_id, total, max_total, source, notes, entered_by)
  values (p_round_id, p_team_id, v_computed_total, p_max_total, 'manual', p_notes, p_admin_id)
  on conflict (round_id, team_id)
    do update set total = v_computed_total, max_total = p_max_total, notes = p_notes,
                  entered_by = p_admin_id, updated_at = now()
  returning id into v_score_id;

  delete from public.score_criterion_values where score_id = v_score_id;

  if p_criterion_values is not null then
    for v_cv in select * from jsonb_array_elements(p_criterion_values) loop
      insert into public.score_criterion_values (score_id, criterion_id, value)
      values (v_score_id, (v_cv ->> 'criterion_id')::uuid, (v_cv ->> 'value')::numeric);
    end loop;
  end if;

  return v_score_id;
end;
$$;

comment on function public.admin_save_score(uuid, uuid, timestamptz, numeric, numeric, jsonb, text, uuid) is
  'SCR-05/06, ERR-07: same optimistic-concurrency shape as '
  'admin_update_team(). Publishing is a separate step (LDB-04). p_admin_id '
  'replaces auth.uid() for entered_by (audit P0 #4).';

revoke all on function public.admin_save_score(uuid, uuid, timestamptz, numeric, numeric, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_save_score(uuid, uuid, timestamptz, numeric, numeric, jsonb, text, uuid) to service_role;

drop function if exists public.admin_add_stage_adjustment(uuid, uuid, numeric, text, text);
create function public.admin_add_stage_adjustment(
  p_stage_id uuid,
  p_team_id uuid,
  p_amount numeric,
  p_reason text,
  p_source_ref text,
  p_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.assert_admin(p_admin_id);

  insert into public.stage_adjustments (stage_id, team_id, amount, reason, source_ref, created_by)
  values (p_stage_id, p_team_id, p_amount, p_reason, p_source_ref, p_admin_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_add_stage_adjustment(uuid, uuid, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_add_stage_adjustment(uuid, uuid, numeric, text, text, uuid) to service_role;

drop function if exists public.admin_confirm_qualifications(uuid, jsonb);
create function public.admin_confirm_qualifications(p_stage_id uuid, p_decisions jsonb, p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_standing record;
  v_decision text;
  v_snapshot jsonb;
begin
  perform public.assert_admin(p_admin_id);

  for v_standing in select * from public.stage_standings(p_stage_id) loop
    select d ->> 'decision' into v_decision
    from jsonb_array_elements(p_decisions) d
    where (d ->> 'team_id')::uuid = v_standing.team_id
    limit 1;

    if v_decision is null then
      continue;
    end if;

    if v_decision not in ('qualified', 'eliminated', 'pending') then
      raise exception '[invalid_decision] Decision must be qualified, eliminated or pending.';
    end if;

    v_snapshot := jsonb_build_object('aggregate', v_standing.aggregate, 'rank', v_standing.rank);

    insert into public.qualifications (stage_id, team_id, rank, aggregate_snapshot, decision, decided_at, decided_by)
    values (p_stage_id, v_standing.team_id, v_standing.rank, v_snapshot, v_decision, now(), p_admin_id)
    on conflict (stage_id, team_id)
      do update set rank = excluded.rank, aggregate_snapshot = excluded.aggregate_snapshot,
                    decision = excluded.decision, decided_at = now(), decided_by = p_admin_id;
  end loop;

  perform public.log_activity(
    (select event_edition_id from public.stages where id = p_stage_id),
    null, 'admin', 'qualifications_confirmed',
    jsonb_build_object('stage_id', p_stage_id, 'decisions', p_decisions)
  );
end;
$$;

comment on function public.admin_confirm_qualifications(uuid, jsonb, uuid) is
  'AT-SCR-02: manual confirmation, never automatic from ranking. p_admin_id '
  'replaces auth.uid() for qualifications.decided_by (audit P0 #4).';

revoke all on function public.admin_confirm_qualifications(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.admin_confirm_qualifications(uuid, jsonb, uuid) to service_role;

drop function if exists public.admin_publish_leaderboard(uuid, text, jsonb, int);
create function public.admin_publish_leaderboard(
  p_event_edition_id uuid,
  p_kind text,
  p_entries jsonb,
  p_entry_limit int,
  p_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot_id uuid;
  v_entry jsonb;
  v_rank int := 0;
begin
  perform public.assert_admin(p_admin_id);

  if p_kind not in ('top_15', 'final_top_10') then
    raise exception '[invalid_kind] Unknown leaderboard kind.';
  end if;

  update public.leaderboard_snapshots
  set hidden_at = now()
  where event_edition_id = p_event_edition_id and kind = p_kind and hidden_at is null;

  insert into public.leaderboard_snapshots (event_edition_id, kind, entry_limit, published_by)
  values (p_event_edition_id, p_kind, p_entry_limit, p_admin_id)
  returning id into v_snapshot_id;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_rank := v_rank + 1;
    insert into public.leaderboard_snapshot_entries (snapshot_id, rank, team_name, score)
    values (
      v_snapshot_id,
      coalesce((v_entry ->> 'rank')::int, v_rank),
      v_entry ->> 'team_name',
      (v_entry ->> 'score')::numeric
    );
  end loop;

  return v_snapshot_id;
end;
$$;

comment on function public.admin_publish_leaderboard(uuid, text, jsonb, int, uuid) is
  'p_admin_id replaces auth.uid() for leaderboard_snapshots.published_by '
  '(audit P0 #4).';

revoke all on function public.admin_publish_leaderboard(uuid, text, jsonb, int, uuid) from public, anon, authenticated;
grant execute on function public.admin_publish_leaderboard(uuid, text, jsonb, int, uuid) to service_role;

drop function if exists public.admin_upsert_announcement(uuid, uuid, text, text, text);
create function public.admin_upsert_announcement(
  p_announcement_id uuid,
  p_event_edition_id uuid,
  p_audience text,
  p_message text,
  p_visibility text,
  p_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.assert_admin(p_admin_id);

  if p_audience not in ('all', 'team', 'public') then
    raise exception '[invalid_audience] Unknown announcement audience.';
  end if;
  if p_visibility not in ('draft', 'published') then
    raise exception '[invalid_visibility] Unknown announcement visibility.';
  end if;

  if p_announcement_id is not null then
    update public.announcements
    set audience = p_audience, message = p_message, visibility = p_visibility
    where id = p_announcement_id
    returning id into v_id;
    if v_id is null then
      raise exception '[not_found] Announcement not found.';
    end if;
  else
    insert into public.announcements (event_edition_id, audience, message, visibility, created_by)
    values (p_event_edition_id, p_audience, p_message, p_visibility, p_admin_id)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_announcement(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_upsert_announcement(uuid, uuid, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Simulation reward RPC (migration 005)
-- ---------------------------------------------------------------------------

drop function if exists public.admin_confirm_simulation_reward(uuid, uuid, uuid, text, numeric, uuid, text);
create function public.admin_confirm_simulation_reward(
  p_config_id uuid,
  p_team_id uuid,
  p_attempt_id uuid,
  p_reward_kind text,
  p_amount numeric,
  p_target_round_id uuid,
  p_reason text,
  p_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward_id uuid;
begin
  perform public.assert_admin(p_admin_id);

  if p_reward_kind not in ('marks', 'purse') then
    raise exception '[invalid_reward_kind] Reward must be marks or purse.';
  end if;
  if p_reward_kind = 'marks' and p_target_round_id is null then
    raise exception '[invalid_reward] A marks reward requires a target round.';
  end if;

  if p_attempt_id is not null and not exists (
    select 1 from public.simulation_attempts
    where id = p_attempt_id and team_id = p_team_id and config_id = p_config_id and success
  ) then
    raise exception '[attempt_not_a_win] The selected attempt was not a winning attempt for this team.';
  end if;

  insert into public.simulation_rewards
    (config_id, team_id, attempt_id, reward_kind, amount, target_round_id, created_by)
  values (p_config_id, p_team_id, p_attempt_id, p_reward_kind, p_amount, p_target_round_id, p_admin_id)
  on conflict (config_id, team_id)
    do update set attempt_id = excluded.attempt_id, reward_kind = excluded.reward_kind,
                  amount = excluded.amount, target_round_id = excluded.target_round_id
  returning id into v_reward_id;

  if p_reward_kind = 'marks' then
    insert into public.scores (round_id, team_id, total, max_total, source, published, notes)
    values (p_target_round_id, p_team_id, p_amount, null, 'simulation', false, p_reason)
    on conflict (round_id, team_id)
      do update set total = excluded.total, notes = excluded.notes, updated_at = now()
      where public.scores.source = 'simulation';
  end if;

  return v_reward_id;
end;
$$;

comment on function public.admin_confirm_simulation_reward(uuid, uuid, uuid, text, numeric, uuid, text, uuid) is
  'SIM-11: unique (config_id, team_id) on simulation_rewards means a team '
  'receives marks OR purse, never both. Also requires a specified attempt '
  'to actually be a winning attempt for that team/config before a reward '
  'can be confirmed against it (audit high-priority #9), and threads '
  'p_admin_id in place of auth.uid() for created_by (audit P0 #4).';

revoke all on function public.admin_confirm_simulation_reward(uuid, uuid, uuid, text, numeric, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_confirm_simulation_reward(uuid, uuid, uuid, text, numeric, uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Analytics RPCs (migration 007) — approve/reject thread p_admin_id;
-- request_analytics keeps its existing signature and simply stamps the
-- already-explicit p_team_id instead of the always-null auth.uid().
-- ---------------------------------------------------------------------------

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
  values (v_team.event_edition_id, p_team_id, v_rule_set.analytics_price, p_team_id)
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
  'requested_by stamps p_team_id (the requesting team''s own id, already '
  'an explicit parameter) instead of auth.uid(), which is always null for '
  'this service-role-invoked function (audit P0 #4). Also enforces stage '
  'qualification (audit P0 #2).';

drop function if exists public.approve_analytics(uuid);
create function public.approve_analytics(p_request_id uuid, p_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.analytics_requests;
  v_team public.teams;
  v_rule_set public.auction_rule_sets;
  v_balance numeric;
  v_ledger_id uuid;
begin
  perform public.assert_admin(p_admin_id);

  select * into v_request from public.analytics_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception '[not_found] Analytics request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception '[already_decided] This request has already been approved or rejected.';
  end if;

  select * into v_team from public.teams where id = v_request.team_id for update;

  select * into v_rule_set from public.auction_rule_sets
  where event_edition_id = v_request.event_edition_id and is_active;
  if v_rule_set.id is null then
    raise exception '[not_found] No active auction rule set.';
  end if;

  select coalesce(sum(amount), 0) into v_balance
  from public.purse_ledger where team_id = v_team.id;

  if v_balance < v_rule_set.analytics_price then
    raise exception '[insufficient_purse] Team''s purse balance is no longer sufficient (re-checked at approval time).'
      using detail = jsonb_build_object('balance', v_balance, 'price', v_rule_set.analytics_price)::text;
  end if;

  update public.analytics_requests set
    status = 'approved', approved_at = now(), approved_by = p_admin_id, price_charged = v_rule_set.analytics_price
  where id = p_request_id;

  insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, created_by, memo)
  values (v_request.event_edition_id, v_team.id, 'analytics', -v_rule_set.analytics_price,
          'analytics_request', p_request_id, p_admin_id, 'Analytics access approved')
  returning id into v_ledger_id;

  update public.analytics_requests set purse_ledger_entry_id = v_ledger_id where id = p_request_id;

  perform public.log_activity(v_request.event_edition_id, v_team.id, 'admin', 'analytics_approved',
    jsonb_build_object('request_id', p_request_id, 'price', v_rule_set.analytics_price));

  perform public.broadcast_live(v_request.event_edition_id, 'analytics', 'approved',
    jsonb_build_object('team_id', v_team.id, 'request_id', p_request_id));

  return jsonb_build_object('request_id', p_request_id, 'team_id', v_team.id, 'price_charged', v_rule_set.analytics_price);
end;
$$;

comment on function public.approve_analytics(uuid, uuid) is
  'AN-05, ERR-10. p_admin_id replaces auth.uid() for approved_by/'
  'purse_ledger.created_by (audit P0 #4).';

revoke all on function public.approve_analytics(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_analytics(uuid, uuid) to service_role;

drop function if exists public.reject_analytics(uuid, text);
create function public.reject_analytics(p_request_id uuid, p_reason text, p_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.analytics_requests;
begin
  perform public.assert_admin(p_admin_id);

  select * into v_request from public.analytics_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception '[not_found] Analytics request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception '[already_decided] This request has already been approved or rejected.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '[reason_required] A rejection reason is required.';
  end if;

  update public.analytics_requests set
    status = 'rejected', rejected_at = now(), rejected_by = p_admin_id, rejection_reason = p_reason
  where id = p_request_id;

  perform public.log_activity(v_request.event_edition_id, v_request.team_id, 'admin', 'analytics_rejected',
    jsonb_build_object('request_id', p_request_id, 'reason', p_reason));

  perform public.broadcast_live(v_request.event_edition_id, 'analytics', 'rejected',
    jsonb_build_object('team_id', v_request.team_id, 'request_id', p_request_id));

  return jsonb_build_object('request_id', p_request_id, 'team_id', v_request.team_id);
end;
$$;

comment on function public.reject_analytics(uuid, text, uuid) is
  'p_admin_id replaces auth.uid() for rejected_by (audit P0 #4).';

revoke all on function public.reject_analytics(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.reject_analytics(uuid, text, uuid) to service_role;

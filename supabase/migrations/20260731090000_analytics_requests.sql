-- Phase 7 — Paid analytics (AN-01..08, AT-AN-01..03).
--
-- purse_ledger.entry_kind already includes 'analytics' (added in Phase 6
-- specifically for this migration) and auction_rule_sets.analytics_price
-- already exists as an admin-editable placeholder — so this migration adds
-- exactly one new table, one curated public view, and three RPCs. No ledger
-- schema change of any kind.

-- ---------------------------------------------------------------------------
-- analytics_requests
-- ---------------------------------------------------------------------------

create table public.analytics_requests (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Reference value only, same "configuration vs. ledger fact" split as
  -- auction_rule_sets.starting_purse: price_at_request is informational
  -- (what the price looked like when the team asked); price_charged is the
  -- authoritative amount actually deducted, set only by approve_analytics()
  -- against the *current* price at approval time (AN-05/ERR-10).
  price_at_request numeric(14, 2) not null,
  price_charged numeric(14, 2),
  requested_by uuid references auth.users (id),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users (id),
  rejected_at timestamptz,
  rejected_by uuid references auth.users (id),
  rejection_reason text,
  purse_ledger_entry_id uuid references public.purse_ledger (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.analytics_requests is
  'AN-06: a team may have at most one *active* (pending or approved) '
  'request at a time — see the partial unique index below, which '
  'deliberately excludes ''rejected'' so a rejected team can request again '
  'with no cooldown. Deduction only ever happens inside approve_analytics(); '
  'a rejected request never touches purse_ledger, so there is nothing to '
  'refund by construction.';

create unique index analytics_requests_one_active_per_team
  on public.analytics_requests (team_id)
  where status in ('pending', 'approved');

create index analytics_requests_event_edition_status_idx
  on public.analytics_requests (event_edition_id, status, requested_at);

create trigger set_updated_at
  before update on public.analytics_requests
  for each row execute function public.set_updated_at();

alter table public.analytics_requests enable row level security;

create policy "analytics_requests_select_own_or_admin"
  on public.analytics_requests for select
  to authenticated
  using (team_id = (select auth.uid()) or public.is_admin());

-- Deliberately no insert/update policy for the team role — every write goes
-- through request_analytics()/approve_analytics()/reject_analytics(), all
-- service_role-only RPCs, same idiom as purse_ledger/teams.
create policy "analytics_requests_admin_write"
  on public.analytics_requests for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Curated public view — deliberately NOT security_invoker (same idiom as
-- public_team_purses/public_sales_feed): the goal is column curation that
-- bypasses analytics_requests' own RLS, collapsing 'pending'/'rejected' both
-- to 'locked' so nothing beyond Locked/Purchased is ever visible publicly
-- (AT-AN-03 satisfied by construction, not by convention).
create view public.public_analytics_status as
select
  t.id as team_id,
  t.event_edition_id,
  case when exists (
    select 1 from public.analytics_requests ar
    where ar.team_id = t.id and ar.status = 'approved'
  ) then 'purchased' else 'locked' end as status
from public.teams t;

grant select on public.public_analytics_status to anon, authenticated;

-- ---------------------------------------------------------------------------
-- request_analytics() — team-initiated, purse-gated (AN-03)
-- ---------------------------------------------------------------------------

-- Locking convention for this migration: request_analytics() only ever
-- inserts a fresh analytics_requests row (never locks one), so the only lock
-- it holds is teams. approve_analytics()/reject_analytics() lock the
-- analytics_requests row first, then teams second (approve only). Since
-- request_analytics() never holds an analytics_requests lock while waiting
-- on teams, and approve/reject never wait on a request_analytics() call (it
-- doesn't hold any lock long enough to conflict), there is no cycle across
-- the three functions.
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
  'AN-03/AN-06. Idempotent on a repeat call while already pending/approved.';

-- ---------------------------------------------------------------------------
-- approve_analytics() — admin-initiated, re-checks purse at approval time,
-- deducts and unlocks in one transaction, never partially (AN-05, ERR-10).
-- ---------------------------------------------------------------------------

create or replace function public.approve_analytics(p_request_id uuid)
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

  -- AN-05/ERR-10: re-check the balance fresh, against the *current* price —
  -- nothing has been written yet, so a failure here leaves the request
  -- untouched (still 'pending') rather than partially applied.
  select coalesce(sum(amount), 0) into v_balance
  from public.purse_ledger where team_id = v_team.id;

  if v_balance < v_rule_set.analytics_price then
    raise exception '[insufficient_purse] Team''s purse balance is no longer sufficient (re-checked at approval time).'
      using detail = jsonb_build_object('balance', v_balance, 'price', v_rule_set.analytics_price)::text;
  end if;

  update public.analytics_requests set
    status = 'approved', approved_at = now(), approved_by = auth.uid(), price_charged = v_rule_set.analytics_price
  where id = p_request_id;

  insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, created_by, memo)
  values (v_request.event_edition_id, v_team.id, 'analytics', -v_rule_set.analytics_price,
          'analytics_request', p_request_id, auth.uid(), 'Analytics access approved')
  returning id into v_ledger_id;

  update public.analytics_requests set purse_ledger_entry_id = v_ledger_id where id = p_request_id;

  perform public.log_activity(v_request.event_edition_id, v_team.id, 'admin', 'analytics_approved',
    jsonb_build_object('request_id', p_request_id, 'price', v_rule_set.analytics_price));

  perform public.broadcast_live(v_request.event_edition_id, 'analytics', 'approved',
    jsonb_build_object('team_id', v_team.id, 'request_id', p_request_id));

  return jsonb_build_object('request_id', p_request_id, 'team_id', v_team.id, 'price_charged', v_rule_set.analytics_price);
end;
$$;

comment on function public.approve_analytics(uuid) is
  'AN-05, ERR-10. Fails cleanly (request stays pending, zero ledger rows '
  'written) if the purse dropped below price between request and approval.';

-- ---------------------------------------------------------------------------
-- reject_analytics() — admin-initiated, never touches the ledger: nothing
-- was ever deducted on request, so there is nothing to refund.
-- ---------------------------------------------------------------------------

create or replace function public.reject_analytics(p_request_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.analytics_requests;
begin
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
    status = 'rejected', rejected_at = now(), rejected_by = auth.uid(), rejection_reason = p_reason
  where id = p_request_id;

  perform public.log_activity(v_request.event_edition_id, v_request.team_id, 'admin', 'analytics_rejected',
    jsonb_build_object('request_id', p_request_id, 'reason', p_reason));

  perform public.broadcast_live(v_request.event_edition_id, 'analytics', 'rejected',
    jsonb_build_object('team_id', v_request.team_id, 'request_id', p_request_id));

  return jsonb_build_object('request_id', p_request_id, 'team_id', v_request.team_id);
end;
$$;

comment on function public.reject_analytics(uuid, text) is
  'A rejected team may call request_analytics() again immediately — the '
  'partial unique index excludes ''rejected'', no cooldown by design.';

-- ---------------------------------------------------------------------------
-- Grants — Supabase auto-grants EXECUTE on new functions directly to anon/
-- authenticated on creation (not just via PUBLIC), so every function here
-- needs an explicit revoke+grant pair, no exceptions.
-- ---------------------------------------------------------------------------

revoke all on function public.request_analytics(uuid) from public, anon, authenticated;
grant execute on function public.request_analytics(uuid) to service_role;

revoke all on function public.approve_analytics(uuid) from public, anon, authenticated;
grant execute on function public.approve_analytics(uuid) to service_role;

revoke all on function public.reject_analytics(uuid, text) from public, anon, authenticated;
grant execute on function public.reject_analytics(uuid, text) to service_role;

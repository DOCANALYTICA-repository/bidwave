-- QA punch-list Phases C2/E1-E4:
--   C2: simulation visibility, decoupled from started_at/stopped_at — the
--       route was reachable to any authenticated team the instant a config
--       row existed, with no admin-controlled show/hide at all.
--   E1: round reopen — the only genuinely reversible admin action was
--       reverse_sale; round lifecycle progression was one-way with no
--       escape hatch for an operator mistake (closed the wrong round).
--       rounds_no_reopen stays in force for every OTHER write path — this
--       migration adds one narrow, audited bypass, not a removal.
--   E2: simulation restart-after-stop — same one-way-only gap, mirrored
--       into admin_set_simulation_lifecycle.
--   E3: reverse_simulation_reward — undo a marks/purse grant, mirroring
--       reverse_sale's ledger-compensation pattern.
--   E4: revoke_analytics_approval — refund an approved-then-revoked
--       analytics unlock, same ledger-compensation pattern.
-- Every new reversal path takes p_admin_id + a mandatory p_reason and
-- writes an activity_events row — no bare UPDATE with no trail.

-- ---------------------------------------------------------------------------
-- C2. Simulation visibility
-- ---------------------------------------------------------------------------

alter table public.simulation_config add column visible_at timestamptz;

comment on column public.simulation_config.visible_at is
  'Independent of started_at/stopped_at — admin can reveal the simulation '
  'page to teams without starting the clock, and hide it again. Null = '
  'hidden (the default), matching "hide by default, admin reveals" (C2).';

-- ---------------------------------------------------------------------------
-- E2 (+ C2's reveal/hide). admin_set_simulation_lifecycle gains reveal,
-- hide, and restart actions. Signature grows with trailing defaulted
-- params so the existing 2-arg call sites (start/stop) keep working
-- unchanged.
-- ---------------------------------------------------------------------------

-- CREATE OR REPLACE cannot change a function's parameter list — it would
-- add a second (uuid, text, uuid, text) overload alongside the existing
-- (uuid, text) one rather than replacing it, and Postgres's exact-arity
-- match means every existing 2-arg call site would keep silently hitting
-- the OLD function forever. Drop the old signature explicitly first.
drop function if exists public.admin_set_simulation_lifecycle(uuid, text);

create or replace function public.admin_set_simulation_lifecycle(
  p_config_id uuid,
  p_action text,
  p_admin_id uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.simulation_config;
begin
  select * into v_config from public.simulation_config where id = p_config_id for update;
  if v_config.id is null then
    raise exception '[not_found] Simulation config not found.';
  end if;

  if p_action = 'start' then
    if v_config.stopped_at is not null then
      raise exception '[simulation_already_stopped] A stopped simulation cannot be restarted this way — use the restart action.';
    end if;
    update public.simulation_config set started_at = now() where id = p_config_id and started_at is null;

  elsif p_action = 'stop' then
    update public.simulation_config set stopped_at = now() where id = p_config_id and stopped_at is null;

  elsif p_action = 'reveal' then
    update public.simulation_config set visible_at = coalesce(visible_at, now()) where id = p_config_id;

  elsif p_action = 'hide' then
    update public.simulation_config set visible_at = null where id = p_config_id;

  elsif p_action = 'restart' then
    if v_config.stopped_at is null then
      raise exception '[simulation_not_stopped] Only a stopped simulation can be restarted.';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception '[reason_required] A reason is required to restart a stopped simulation.';
    end if;
    perform public.assert_admin(p_admin_id);
    -- A fresh timer window, not just clearing stopped_at — nulling only
    -- stopped_at while leaving the old started_at in place would read as
    -- an already-expired timer the instant the button is clicked.
    update public.simulation_config set started_at = now(), stopped_at = null where id = p_config_id;
    perform public.log_activity(
      v_config.event_edition_id, null, 'admin', 'simulation_restarted',
      jsonb_build_object('config_id', p_config_id, 'admin_id', p_admin_id, 'reason', p_reason)
    );

  else
    raise exception '[invalid_action] Unknown simulation lifecycle action.';
  end if;
end;
$$;

comment on function public.admin_set_simulation_lifecycle(uuid, text, uuid, text) is
  'SIM-02/10 plus C2 (reveal/hide) and E2 (restart, audited, reason-required — '
  'a deliberate narrow exception to "a stopped simulation cannot be restarted").';

revoke all on function public.admin_set_simulation_lifecycle(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_simulation_lifecycle(uuid, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- E3. Undo a simulation reward grant.
-- ---------------------------------------------------------------------------

create or replace function public.reverse_simulation_reward(
  p_config_id uuid,
  p_team_id uuid,
  p_admin_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.simulation_rewards;
  v_event_edition_id uuid;
  v_ledger_id uuid;
begin
  perform public.assert_admin(p_admin_id);
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '[reason_required] A reason is required to reverse a reward.';
  end if;

  select * into v_reward from public.simulation_rewards
  where config_id = p_config_id and team_id = p_team_id for update;
  if v_reward.id is null then
    raise exception '[not_found] Reward not found.';
  end if;

  select event_edition_id into v_event_edition_id
  from public.simulation_config where id = v_reward.config_id;

  if v_reward.reward_kind = 'marks' then
    delete from public.scores
    where round_id = v_reward.target_round_id and team_id = v_reward.team_id and source = 'simulation';
  elsif v_reward.purse_applied_at is not null then
    insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, created_by, memo)
    values (v_event_edition_id, v_reward.team_id, 'reversal', -v_reward.amount, 'simulation_rewards', v_reward.id, p_admin_id, p_reason)
    returning id into v_ledger_id;
  end if;

  delete from public.simulation_rewards where id = v_reward.id;

  perform public.log_activity(
    v_event_edition_id, v_reward.team_id, 'admin', 'simulation_reward_reversed',
    jsonb_build_object('reward_id', v_reward.id, 'reason', p_reason, 'ledger_entry_id', v_ledger_id)
  );

  return jsonb_build_object('reward_id', v_reward.id, 'team_id', v_reward.team_id);
end;
$$;

comment on function public.reverse_simulation_reward(uuid, uuid, uuid, text) is
  'Deletes the (config_id, team_id) reward row (marks or purse, never both — '
  'see the unique constraint) and writes a compensating negative purse_ledger '
  'entry if the purse variant had already been applied. Mirrors reverse_sale.';

revoke all on function public.reverse_simulation_reward(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_simulation_reward(uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- E4. Revoke an approved analytics unlock (refund).
-- ---------------------------------------------------------------------------

alter table public.analytics_requests drop constraint analytics_requests_status_check;
alter table public.analytics_requests add constraint analytics_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'revoked'));

create or replace function public.revoke_analytics_approval(
  p_request_id uuid,
  p_reason text,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.analytics_requests;
  v_ledger_id uuid;
begin
  perform public.assert_admin(p_admin_id);
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '[reason_required] A reason is required to revoke this approval.';
  end if;

  select * into v_request from public.analytics_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception '[not_found] Analytics request not found.';
  end if;
  if v_request.status <> 'approved' then
    raise exception '[not_approved] Only an approved request can be revoked.';
  end if;

  update public.analytics_requests set status = 'revoked' where id = p_request_id;

  if v_request.price_charged is not null then
    insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount, ref_kind, ref_id, created_by, memo)
    values (v_request.event_edition_id, v_request.team_id, 'reversal', v_request.price_charged,
            'analytics_request', p_request_id, p_admin_id, p_reason)
    returning id into v_ledger_id;
  end if;

  perform public.log_activity(
    v_request.event_edition_id, v_request.team_id, 'admin', 'analytics_revoked',
    jsonb_build_object('request_id', p_request_id, 'reason', p_reason, 'ledger_entry_id', v_ledger_id)
  );

  perform public.broadcast_live(
    v_request.event_edition_id, 'analytics', 'revoked',
    jsonb_build_object('team_id', v_request.team_id, 'request_id', p_request_id)
  );

  return jsonb_build_object('request_id', p_request_id, 'team_id', v_request.team_id, 'refunded', v_request.price_charged);
end;
$$;

comment on function public.revoke_analytics_approval(uuid, text, uuid) is
  'Refunds price_charged via a compensating positive purse_ledger entry — '
  'the exact mirror of approve_analytics''s deduction. Unlike reject_analytics '
  '(which only applies to still-pending requests and never touches the '
  'ledger), this is the missing undo for an *already-approved* request.';

revoke all on function public.revoke_analytics_approval(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.revoke_analytics_approval(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- E1. Round reopen — a narrow, audited bypass of rounds_no_reopen.
-- ---------------------------------------------------------------------------

create or replace function public.rounds_no_reopen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.closed_at is not null and new.closed_at is null
     and coalesce(current_setting('bidwave.allow_reopen', true), 'false') <> 'true' then
    raise exception '[round_already_closed] A closed round cannot be reopened.';
  end if;
  return new;
end;
$$;

comment on function public.rounds_no_reopen() is
  'Defense in depth against reopening a closed round via any direct table '
  'write. admin_set_round_lifecycle''s ''reopen'' action is the one narrow, '
  'audited exception — it sets bidwave.allow_reopen for its own transaction '
  'only, right before the update, so this guard still blocks every other path.';

drop function if exists public.admin_set_round_lifecycle(uuid, text);

create or replace function public.admin_set_round_lifecycle(
  p_round_id uuid,
  p_action text,
  p_admin_id uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if v_round.id is null then
    raise exception '[not_found] Round not found.';
  end if;

  if p_action = 'open_now' then
    if v_round.closed_at is not null then
      raise exception '[round_already_closed] A closed round cannot be reopened.';
    end if;
    update public.rounds set opened_early_at = now() where id = p_round_id;

  elsif p_action = 'close_now' then
    update public.rounds set closed_at = now() where id = p_round_id and closed_at is null;

  elsif p_action = 'start_scoring' then
    if v_round.closed_at is null and (v_round.closes_at is null or now() < v_round.closes_at) then
      raise exception '[round_not_closed] Scoring can only start once the round is closed.';
    end if;
    update public.rounds set
      scoring_started_at = now(),
      closed_at = coalesce(closed_at, now())
    where id = p_round_id and scoring_started_at is null;

  elsif p_action = 'mark_scored' then
    update public.rounds set scored_at = now() where id = p_round_id and scored_at is null;

  elsif p_action = 'release_publicly' then
    if v_round.closed_at is null or v_round.scored_at is null then
      raise exception '[round_not_scored] A round can only be released publicly once closed and scored.';
    end if;
    update public.rounds set public_released_at = now() where id = p_round_id and public_released_at is null;

  elsif p_action = 'unrelease' then
    update public.rounds set public_released_at = null where id = p_round_id;

  elsif p_action = 'archive' then
    update public.rounds set archived_at = now() where id = p_round_id and archived_at is null;

  elsif p_action = 'reopen' then
    if v_round.closed_at is null then
      raise exception '[round_not_closed] This round is not closed.';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception '[reason_required] A reason is required to reopen a round.';
    end if;
    perform public.assert_admin(p_admin_id);
    -- Cascade-clear the whole downstream pipeline, not just closed_at —
    -- otherwise the round lands in a contradictory "open but scored/
    -- released" state. Scores already entered are untouched; only the
    -- lifecycle timestamps reset, so scoring/publish must be redone.
    perform set_config('bidwave.allow_reopen', 'true', true);
    update public.rounds set
      closed_at = null,
      scoring_started_at = null,
      scored_at = null,
      public_released_at = null
    where id = p_round_id;
    perform public.log_activity(
      v_round.event_edition_id, null, 'admin', 'round_reopened',
      jsonb_build_object('round_id', p_round_id, 'admin_id', p_admin_id, 'reason', p_reason)
    );

  else
    raise exception '[invalid_action] Unknown round lifecycle action.';
  end if;
end;
$$;

comment on function public.admin_set_round_lifecycle(uuid, text, uuid, text) is
  'start_scoring stamps closed_at (coalesced) so a clock-closed round can '
  'still reach release_publicly later (audit high-priority #11). ''reopen'' '
  '(E1) is reason-required and audited — the one sanctioned way past '
  'rounds_no_reopen, for correcting an operator mistake, not for letting a '
  'team resubmit after seeing results.';

revoke all on function public.admin_set_round_lifecycle(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_round_lifecycle(uuid, text, uuid, text) to service_role;

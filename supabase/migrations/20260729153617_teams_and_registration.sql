-- Migration 002 — Teams and registration
-- One shared auth account per team, member roster, invoice upload, activity
-- log, a generic rate-limit primitive, and the register_team() RPC that
-- creates all of it atomically.
--
-- PRD references: §3 (roles), §7 (registration), REG-01..12, §7.3
-- (validation), §20/§20.1 (data model + integrity), §21.2 (team
-- progression), §22 (security), §27 (error handling), §28.1 (AT-REG-01..05).

-- citext (migration 001) lives in the "extensions" schema, not public;
-- Supabase's PostgREST layer already has extensions on its search_path
-- (config.toml [api] extra_search_path), but a plain SQL session — such as
-- this migration running over a direct pg connection — does not, so it
-- must be set explicitly here.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Registration window override — extends event_editions (REG-12)
-- ---------------------------------------------------------------------------

-- Reuses migration 001's registration_opens_at/registration_closes_at.
-- Admin override follows the same "status is a SQL function of the clock"
-- principle as the round-status model coming in migration 003 — a missed
-- schedule check must never be the only thing standing between a late
-- registration and the database.
alter table public.event_editions
  add column registration_override text
    check (registration_override in ('open', 'closed'));

create or replace function public.is_registration_open(p_event_edition_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case e.registration_override
    when 'open' then true
    when 'closed' then false
    else
      (e.registration_opens_at is null or now() >= e.registration_opens_at)
      and (e.registration_closes_at is null or now() < e.registration_closes_at)
  end
  from public.event_editions e
  where e.id = p_event_edition_id;
$$;

comment on function public.is_registration_open(uuid) is
  'REG-12: registration is open per the schedule unless admin has forced '
  'it open or closed. Read-only, safe for anon/authenticated (event_editions '
  'already has a public select policy).';

-- ---------------------------------------------------------------------------
-- Teams — one row per team, id IS the team''s single shared auth.users id
-- ---------------------------------------------------------------------------

create table public.teams (
  id uuid primary key references auth.users (id) on delete cascade,
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  name citext not null,
  campus text not null,
  captain_email citext not null,
  status text not null default 'active' check (status in ('active', 'disqualified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_name_unique unique (event_edition_id, name)
);

comment on table public.teams is
  'One shared team account (§7.2). id = the team''s single auth.users row, '
  'never a separate FK — there is exactly one login per team, forever, so '
  'this collapses identity and auth into one row instead of two kept in sync.';

create trigger set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

alter table public.teams enable row level security;

create policy "teams_select_own_or_admin"
  on public.teams for select
  to authenticated
  using (id = (select auth.uid()) or public.is_admin());

-- No insert/update/delete policy for team/anon roles at all: REG-11
-- ("participants cannot edit registration data after submission") means
-- teams never get a write path here. All writes go through register_team()
-- and admin_update_team() below, both SECURITY DEFINER and granted to
-- service_role only — see the grants at the end of this file.
create policy "teams_admin_write"
  on public.teams for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Team members
-- ---------------------------------------------------------------------------

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  -- Denormalized from teams.event_edition_id so uniqueness (REG-10) can be a
  -- plain compound index scoped per edition, not a trigger doing a parent
  -- lookup. Reuse of a register number/email is blocked within an edition,
  -- not for all time — NFR-09 means the same real student may return in a
  -- future edition.
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  full_name text not null,
  class text not null,
  register_number citext not null,
  phone text not null,
  christ_email citext not null,
  is_captain boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_members_register_number_unique unique (event_edition_id, register_number),
  constraint team_members_christ_email_unique unique (event_edition_id, christ_email)
);

comment on table public.team_members is
  'REG-02/03: 3 compulsory + 1 optional member per team. Cardinality and '
  '"exactly one captain" are enforced in register_team()/admin_update_team() '
  '(the only write paths), not by a table CHECK — Postgres can''t express '
  '"between 3 and 4 sibling rows" as one, and both write paths already '
  'validate the whole member set atomically before committing.';

create trigger set_updated_at
  before update on public.team_members
  for each row execute function public.set_updated_at();

alter table public.team_members enable row level security;

create policy "team_members_select_own_or_admin"
  on public.team_members for select
  to authenticated
  using (team_id = (select auth.uid()) or public.is_admin());

create policy "team_members_admin_write"
  on public.team_members for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Invoices — one row per team (upsertable), file lives in private storage
-- ---------------------------------------------------------------------------

create table public.invoices (
  team_id uuid primary key references public.teams (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  uploaded_at timestamptz not null default now()
);

comment on table public.invoices is
  'REG-07/SEC-04: file itself lives in the private "invoices" storage '
  'bucket at {team_id}/{file_name}; this row is only the pointer + metadata.';

alter table public.invoices enable row level security;

create policy "invoices_select_own_or_admin"
  on public.invoices for select
  to authenticated
  using (team_id = (select auth.uid()) or public.is_admin());

create policy "invoices_admin_write"
  on public.invoices for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Activity events — login/registration activity (RND-09, REP-06, ADM-13)
-- ---------------------------------------------------------------------------

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  actor_role text not null check (actor_role in ('team', 'admin', 'public')),
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.activity_events is
  'Append-only. Written exclusively via log_activity() (service_role only) '
  '— no direct insert policy exists for any client role.';

create index activity_events_team_id_idx on public.activity_events (team_id);
create index activity_events_event_edition_id_created_at_idx
  on public.activity_events (event_edition_id, created_at desc);

alter table public.activity_events enable row level security;

create policy "activity_events_select_own_or_admin"
  on public.activity_events for select
  to authenticated
  using (team_id = (select auth.uid()) or public.is_admin());

-- ---------------------------------------------------------------------------
-- Rate limiting primitive (SEC-10) — reused by every phase that adds an
-- abuse-prone endpoint (quiz submit, simulation attempt, ...), not just
-- registration.
-- ---------------------------------------------------------------------------

create table public.rate_limit_buckets (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (bucket, key, window_start)
);

comment on table public.rate_limit_buckets is
  'Fixed-window counters. No client role has any policy on this table at '
  'all — it is only ever touched from inside check_rate_limit().';

alter table public.rate_limit_buckets enable row level security;

create or replace function public.check_rate_limit(
  p_bucket text,
  p_key text,
  p_max_count int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_buckets (bucket, key, window_start, count)
  values (p_bucket, p_key, v_window_start, 1)
  on conflict (bucket, key, window_start)
    do update set count = public.rate_limit_buckets.count + 1
  returning count into v_count;

  -- Opportunistic cleanup — cheap enough to run inline; no separate cron
  -- job needed for what is, at Bidwave's scale, a tiny table.
  delete from public.rate_limit_buckets
  where bucket = p_bucket
    and window_start < now() - (p_window_seconds * 2) * interval '1 second';

  return v_count <= p_max_count;
end;
$$;

comment on function public.check_rate_limit(text, text, int, int) is
  'Returns true iff the caller is still within limit. SEC-10: called from '
  'trusted Next.js server code (Server Actions), keyed by client IP or '
  'similar, before the guarded operation proceeds — never called from the '
  'browser directly.';

-- ---------------------------------------------------------------------------
-- Activity logging helper
-- ---------------------------------------------------------------------------

create or replace function public.log_activity(
  p_event_edition_id uuid,
  p_team_id uuid,
  p_actor_role text,
  p_kind text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_events (event_edition_id, team_id, actor_role, kind, detail)
  values (p_event_edition_id, p_team_id, p_actor_role, p_kind, p_detail);
$$;

-- ---------------------------------------------------------------------------
-- register_team() — the one atomic RPC behind /register
-- ---------------------------------------------------------------------------

create or replace function public.register_team(
  p_auth_user_id uuid,
  p_event_edition_id uuid,
  p_team_name text,
  p_campus text,
  p_members jsonb,
  p_invoice_storage_path text,
  p_invoice_file_name text,
  p_invoice_mime_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_captain_email extensions.citext;
  v_constraint_name text;
begin
  if not public.is_registration_open(p_event_edition_id) then
    raise exception '[registration_closed] Registration is not currently open.';
  end if;

  if jsonb_array_length(p_members) < 3 or jsonb_array_length(p_members) > 4 then
    raise exception '[invalid_member_count] Teams must have 3 or 4 members.';
  end if;

  if (
    select count(*) from jsonb_array_elements(p_members) m
    where (m ->> 'is_captain')::boolean
  ) <> 1 then
    raise exception '[missing_captain] Exactly one member must be marked as captain.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_members) m
    where (m ->> 'christ_email') !~* '\.christuniversity\.in$'
  ) then
    raise exception '[invalid_email_domain] All member emails must end in .christuniversity.in';
  end if;

  select m ->> 'christ_email' into v_captain_email
  from jsonb_array_elements(p_members) m
  where (m ->> 'is_captain')::boolean
  limit 1;

  begin
    insert into public.teams (id, event_edition_id, name, campus, captain_email)
    values (p_auth_user_id, p_event_edition_id, p_team_name, p_campus, v_captain_email);
  exception when unique_violation then
    raise exception '[duplicate_team_name] Team name "%" is already registered.', p_team_name;
  end;

  begin
    insert into public.team_members
      (team_id, event_edition_id, full_name, class, register_number, phone, christ_email, is_captain)
    select
      p_auth_user_id,
      p_event_edition_id,
      m ->> 'full_name',
      m ->> 'class',
      m ->> 'register_number',
      m ->> 'phone',
      m ->> 'christ_email',
      (m ->> 'is_captain')::boolean
    from jsonb_array_elements(p_members) m;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'team_members_register_number_unique' then
      raise exception '[duplicate_register_number] One of the register numbers is already registered for this edition.';
    elsif v_constraint_name = 'team_members_christ_email_unique' then
      raise exception '[duplicate_email] One of the member emails is already registered for this edition.';
    else
      raise exception '[duplicate_member_field] A member field is already registered.';
    end if;
  end;

  insert into public.invoices (team_id, storage_path, file_name, mime_type)
  values (p_auth_user_id, p_invoice_storage_path, p_invoice_file_name, p_invoice_mime_type);

  perform public.log_activity(
    p_event_edition_id, p_auth_user_id, 'team', 'registration_submitted',
    jsonb_build_object('team_name', p_team_name)
  );

  return p_auth_user_id;
end;
$$;

comment on function public.register_team(uuid, uuid, text, text, jsonb, text, text, text) is
  'AT-REG-01..04: one transaction for team + members + invoice pointer. '
  'Not truly the *only* step in registration end to end — creating the '
  'auth.users row happens first via the Admin API (plpgsql cannot call it), '
  'and the Next.js server action deletes that auth user + uploaded file if '
  'this function raises. See src/app/register/actions.ts.';

-- ---------------------------------------------------------------------------
-- admin_update_team() — ADM-02 edit, REG-11 (admin-only), ERR-07 (stale edit)
-- ---------------------------------------------------------------------------

create or replace function public.admin_update_team(
  p_team_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_campus text,
  p_members jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual_updated_at timestamptz;
  v_event_edition_id uuid;
  v_captain_email extensions.citext;
  v_constraint_name text;
begin
  select updated_at, event_edition_id into v_actual_updated_at, v_event_edition_id
  from public.teams where id = p_team_id
  for update; -- lock the row for the duration of this edit

  if v_actual_updated_at is null then
    raise exception '[not_found] Team not found.';
  end if;

  if v_actual_updated_at <> p_expected_updated_at then
    raise exception '[stale_edit] This team was edited by someone else — refresh and try again.';
  end if;

  if jsonb_array_length(p_members) < 3 or jsonb_array_length(p_members) > 4 then
    raise exception '[invalid_member_count] Teams must have 3 or 4 members.';
  end if;

  if (
    select count(*) from jsonb_array_elements(p_members) m
    where (m ->> 'is_captain')::boolean
  ) <> 1 then
    raise exception '[missing_captain] Exactly one member must be marked as captain.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_members) m
    where (m ->> 'christ_email') !~* '\.christuniversity\.in$'
  ) then
    raise exception '[invalid_email_domain] All member emails must end in .christuniversity.in';
  end if;

  select m ->> 'christ_email' into v_captain_email
  from jsonb_array_elements(p_members) m
  where (m ->> 'is_captain')::boolean
  limit 1;

  begin
    update public.teams
    set name = p_name, campus = p_campus, captain_email = v_captain_email
    where id = p_team_id;
  exception when unique_violation then
    raise exception '[duplicate_team_name] Team name "%" is already registered.', p_name;
  end;

  delete from public.team_members where team_id = p_team_id;

  begin
    insert into public.team_members
      (team_id, event_edition_id, full_name, class, register_number, phone, christ_email, is_captain)
    select
      p_team_id,
      v_event_edition_id,
      m ->> 'full_name',
      m ->> 'class',
      m ->> 'register_number',
      m ->> 'phone',
      m ->> 'christ_email',
      (m ->> 'is_captain')::boolean
    from jsonb_array_elements(p_members) m;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'team_members_register_number_unique' then
      raise exception '[duplicate_register_number] One of the register numbers is already registered for this edition.';
    elsif v_constraint_name = 'team_members_christ_email_unique' then
      raise exception '[duplicate_email] One of the member emails is already registered for this edition.';
    else
      raise exception '[duplicate_member_field] A member field is already registered.';
    end if;
  end;

  perform public.log_activity(
    v_event_edition_id, p_team_id, 'admin', 'team_edited_by_admin', '{}'::jsonb
  );
end;
$$;

comment on function public.admin_update_team(uuid, timestamptz, text, text, jsonb) is
  'ADM-02/REG-11: admin-only edit of team + full member replacement. '
  'ERR-07: p_expected_updated_at must match the row''s current updated_at '
  'or this raises [stale_edit] instead of silently overwriting a '
  'concurrent change.';

-- ---------------------------------------------------------------------------
-- Storage — private "invoices" bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

create policy "invoices_bucket_select_own_or_admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'invoices'
    and (
      (storage.foldername(name))[1] = (select auth.uid()::text)
      or public.is_admin()
    )
  );

create policy "invoices_bucket_admin_write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'invoices' and public.is_admin());

create policy "invoices_bucket_admin_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'invoices' and public.is_admin())
  with check (bucket_id = 'invoices' and public.is_admin());

create policy "invoices_bucket_admin_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'invoices' and public.is_admin());

-- Registration's own upload happens via the service-role admin client
-- (before the captain has a session at all), which bypasses these RLS
-- policies entirely — they exist for later authenticated access only.

-- ---------------------------------------------------------------------------
-- Grants — every mutation RPC above is service_role only. All of this
-- project's mutations run from trusted Next.js server code (Server
-- Actions), never called directly from the browser; anon/authenticated
-- never get EXECUTE on these, closing the default-PUBLIC-grant hole.
-- ---------------------------------------------------------------------------

-- Supabase grants EXECUTE on newly created public-schema functions to
-- anon/authenticated directly (via its own ALTER DEFAULT PRIVILEGES setup)
-- — not merely through PUBLIC membership — so "revoke ... from public"
-- alone does NOT remove their access. Each role that shouldn't be able to
-- call these directly must be revoked explicitly.
revoke all on function public.register_team(uuid, uuid, text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.register_team(uuid, uuid, text, text, jsonb, text, text, text) to service_role;

revoke all on function public.admin_update_team(uuid, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_update_team(uuid, timestamptz, text, text, jsonb) to service_role;

revoke all on function public.check_rate_limit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, text, int, int) to service_role;

revoke all on function public.log_activity(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_activity(uuid, uuid, text, text, jsonb) to service_role;

-- is_registration_open() stays PUBLIC-executable (default) — it's read-only
-- and used to show registration state on the public site.

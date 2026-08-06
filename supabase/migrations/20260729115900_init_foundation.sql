-- Migration 001 — Foundation
-- Extensions, auth helpers, event editions, and the admin-editable settings
-- store. Every later migration builds on the helpers defined here.
--
-- PRD references: §20 (data model), §20.1 (integrity principles), §21.1
-- (round state model — pg_cron enabled here, used starting migration 003),
-- NFR-09 (isolate edition-specific config so future editions can reuse the
-- schema without a rewrite).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- gen_random_uuid() for primary keys.
create extension if not exists pgcrypto with schema extensions;

-- Case-insensitive text — used for team names, register numbers and CHRIST
-- emails so "TeamA" and "teama" collide the way a human expects (AT-REG-03,
-- AT-REG-04), without every query needing an explicit lower().
create extension if not exists citext with schema extensions;

-- Scheduled jobs — the effective-round-status materializer (migration 003)
-- and any future housekeeping jobs run through this. Architecture principle
-- #3: pg_cron only *materializes* transitions a SQL function already
-- computes from the clock; it is never the sole authority on state.
create extension if not exists pg_cron with schema extensions;

-- ---------------------------------------------------------------------------
-- Auth helpers
-- ---------------------------------------------------------------------------

-- Bidwave has exactly two authenticated roles (§3.1): 'team' (one shared
-- account per registered team) and 'admin' (the single full-permission
-- role, usable from multiple devices at once — §14.5, SEC-09). The role
-- lives in the JWT's app_metadata so it's tamper-proof from the client and
-- available to every RLS policy without a join.
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

comment on function public.is_admin() is
  'True when the current request''s JWT carries app_metadata.role = admin. '
  'The single source of truth every admin-only RLS policy should check.';

-- Reusable updated_at maintenance — attach with:
--   create trigger set_updated_at before update on <table>
--   for each row execute function public.set_updated_at();
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Event editions
-- ---------------------------------------------------------------------------

-- NFR-09: this edition ships first, but every operational table below hangs
-- off event_edition_id so a future edition is a new row here, not a schema
-- migration or a data-migration exercise.
create table public.event_editions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext not null unique,
  starts_on date not null,
  ends_on date not null,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.event_editions is
  'One row per Bidwave edition. Exactly one may be is_active at a time '
  '(enforced by the partial unique index below) — every operational table '
  'scopes to whichever edition is active.';

-- Only one active edition at a time.
create unique index event_editions_one_active
  on public.event_editions (is_active)
  where is_active;

create trigger set_updated_at
  before update on public.event_editions
  for each row execute function public.set_updated_at();

alter table public.event_editions enable row level security;

-- Everyone (including anonymous public visitors) can see which edition is
-- live and its dates — that's landing-page content, not private data.
create policy "event_editions_select_all"
  on public.event_editions for select
  to anon, authenticated
  using (true);

create policy "event_editions_admin_write"
  on public.event_editions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Seed the 2026 edition from the brochure (reference/BIDWAVE brochure (flags).pdf).
insert into public.event_editions (name, slug, starts_on, ends_on, is_active)
values ('Bidwave 2026', 'bidwave-2026', '2026-08-17', '2026-08-19', true);

-- ---------------------------------------------------------------------------
-- Settings — admin-editable content that the PRD does not hardcode
-- ---------------------------------------------------------------------------

-- Covers: WhatsApp joining link (DEP-04), prizes copy, registration fee and
-- payment instructions, registration window override, FAQs, contacts
-- (§30 dependencies still required). Ships with clearly-marked placeholder
-- values per the user's instruction; admins replace them with no code
-- change. `is_public` controls whether an unauthenticated visitor may read
-- a key — kept separate from the value itself so a key can be prepared
-- privately before publishing.
create table public.settings (
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  key text not null,
  value jsonb not null,
  is_public boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  primary key (event_edition_id, key)
);

comment on table public.settings is
  'Admin-editable key/value content for the public site and operations — '
  'the "code-managed" static content PUB-08 allows is managed here instead, '
  'so it never requires a deploy to change.';

create trigger set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

alter table public.settings enable row level security;

create policy "settings_select_public"
  on public.settings for select
  to anon, authenticated
  using (is_public or public.is_admin());

create policy "settings_admin_write"
  on public.settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Placeholder seed content — every value here is a deliberate, clearly
-- fake placeholder pending the real input listed in PRD §30.
insert into public.settings (event_edition_id, key, value, is_public)
select
  e.id,
  v.key,
  v.value,
  v.is_public
from public.event_editions e
cross join (
  values
    ('whatsapp_link', '"https://chat.whatsapp.com/PLACEHOLDER"'::jsonb, true),
    ('registration_fee', '{"amount": null, "currency": "INR", "note": "Fee to be announced — placeholder pending DEP-06/DEP-07 input."}'::jsonb, true),
    ('payment_instructions', '"Payment instructions will be published here before registration opens."'::jsonb, true),
    ('prizes', '[{"place": "Winner", "detail": "Prize details to be announced."}, {"place": "Runner-up", "detail": "Prize details to be announced."}]'::jsonb, true),
    ('faqs', '[{"question": "Who can participate?", "answer": "Teams of 3 (plus an optional 4th member), all students of CHRIST University, Bangalore."}]'::jsonb, true),
    ('contacts', '[{"name": "Neha Rani CK", "role": "Event Head", "phone": "6360218039"}, {"name": "Ankitha", "role": "President", "phone": "9448755245"}, {"name": "Adith P", "role": "President", "phone": "7204444995"}]'::jsonb, true),
    ('instagram_url', '"https://www.instagram.com/bid_wave"'::jsonb, true)
) as v(key, value, is_public)
where e.slug = 'bidwave-2026';

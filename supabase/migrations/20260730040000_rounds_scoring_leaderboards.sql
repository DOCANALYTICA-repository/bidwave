-- Migration 003 — Round engine, submissions, scoring, qualification, leaderboards
-- Rounds as a clock-driven state machine, the Rounds 2-4 multi-file
-- submission framework, total-or-rubric scoring, stage aggregation with a
-- closed tie-breaker vocabulary, manual qualification confirmation, and
-- immutable leaderboard publication snapshots.
--
-- PRD references: §6.1, §8/§8.1, §9/§9.1, §11.2, §12, §18, §19.1, §20/§20.1,
-- §21.1/§21.2, §22 (SEC-01/02/04/06/11), §27 (ERR-03/07), §28.2/§28.3
-- (AT-RND-01..03, AT-SCR-01..03, AT-LDB-01), RND-01..09, SUB-01..09,
-- SCR-01..07, LDB-01..07, DASH-01..07, R6-04.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Stages — R1+R2 / R3+R4 / R6 / Final aggregates and their tie-breaker config
-- ---------------------------------------------------------------------------

create table public.stages (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  code text not null check (code in ('r1_r2', 'r3_r4', 'r6', 'final')),
  label text not null,
  -- Small closed vocabulary, not an open expression language: at most two
  -- ordered rules, e.g. [{"kind":"higher_round_score","round_id":"..."},
  -- {"kind":"earlier_submission","round_id":"..."}]. stage_standings() below
  -- is the only reader; every rule kind it understands is enumerated there.
  tie_breaker_rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stages_code_unique unique (event_edition_id, code)
);

comment on table public.stages is
  'SCR-01/02/04: the four aggregate points (R1+R2, R3+R4, R6, Final). '
  'stage_rounds below wires which rounds contribute and at what weight.';

create trigger set_updated_at
  before update on public.stages
  for each row execute function public.set_updated_at();

alter table public.stages enable row level security;

create policy "stages_admin_all"
  on public.stages for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Rounds — a clock-driven state machine (§21.1), mirroring
-- is_registration_open()'s "status is a SQL function of the clock" shape.
-- ---------------------------------------------------------------------------

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  -- All six kinds enumerated now (Phases 4-6 add rows against this same
  -- CHECK, never a new constraint) even though this session only uses
  -- quiz/submission/offline_info.
  kind text not null check (kind in ('quiz', 'submission', 'offline_info', 'simulation', 'auction', 'conference')),
  sequence int not null,
  slug citext not null,
  title text not null,
  brief text,
  instructions text,
  opens_at timestamptz,
  closes_at timestamptz,
  -- The admin override is two ONE-WAY timestamps, not a reversible
  -- text check in ('open','closed') like is_registration_open() uses.
  -- Reopening registration is harmless; RND-05 makes reopening a round
  -- forbidden, so making "reopen" unrepresentable is stronger than a
  -- trigger alone (the trigger below is defense in depth, not the only
  -- guard).
  opened_early_at timestamptz,
  closed_at timestamptz,
  scoring_started_at timestamptz,
  scored_at timestamptz,
  public_released_at timestamptz,
  archived_at timestamptz,
  requires_qualification_from_stage uuid references public.stages (id) on delete set null,
  rubric_total_mode text not null default 'weighted_sum'
    check (rubric_total_mode in ('weighted_sum', 'weighted_percent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rounds_slug_unique unique (event_edition_id, slug),
  constraint rounds_sequence_unique unique (event_edition_id, sequence)
);

comment on table public.rounds is
  'RND-01..09: one row per competition round. effective_round_status() '
  'below derives §21.1''s Draft/Scheduled/Open/Closed/Scoring/Scored/'
  'Publicly-released/Archived states from these timestamps and now() — '
  'never from a stored status column that a missed cron tick could leave '
  'stale.';

create trigger set_updated_at
  before update on public.rounds
  for each row execute function public.set_updated_at();

-- RND-05: defense in depth. The one-way-timestamp design already makes
-- reopening structurally hard; this trigger blocks the one remaining path
-- (a direct UPDATE nulling closed_at back out) at the database level too.
create or replace function public.rounds_no_reopen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.closed_at is not null and new.closed_at is null then
    raise exception '[round_already_closed] A closed round cannot be reopened.';
  end if;
  return new;
end;
$$;

create trigger rounds_no_reopen
  before update on public.rounds
  for each row execute function public.rounds_no_reopen();

alter table public.rounds enable row level security;

-- RND-03: all registered teams (and admin) can view every round regardless
-- of public-release state — public release (below) is a separate, later
-- gate for anonymous visitors only.
create policy "rounds_select_authenticated"
  on public.rounds for select
  to authenticated
  using (true);

create policy "rounds_select_public_released"
  on public.rounds for select
  to anon
  using (public_released_at is not null);

create policy "rounds_admin_write"
  on public.rounds for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- effective_round_status() takes the row type directly (cheap at this
-- project's scale — a few rounds, a few dozen policy evaluations). If
-- `rounds` is ever restructured, this function, rounds_with_status and any
-- policy referencing it must be dropped and recreated together.
create or replace function public.effective_round_status(r public.rounds)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when r.archived_at is not null then 'archived'
    when r.public_released_at is not null then 'publicly_released'
    when r.scored_at is not null then 'scored'
    when r.scoring_started_at is not null then 'scoring'
    when r.closed_at is not null then 'closed'
    when r.closes_at is not null and now() >= r.closes_at then 'closed'
    when r.opened_early_at is not null then 'open'
    when r.opens_at is not null and now() >= r.opens_at then 'open'
    when r.opens_at is not null then 'scheduled'
    else 'draft'
  end;
$$;

comment on function public.effective_round_status(public.rounds) is
  'RND-01/02/05/06: pure function of the clock plus the two one-way admin '
  'overrides. "Scoring" has no §8.1 team-facing word — teams see "Closed" '
  'throughout that state; only the admin console distinguishes it.';

-- This project''s first view. security_invoker = true is required — without
-- it the view runs as its owner and silently bypasses rounds RLS.
create view public.rounds_with_status
with (security_invoker = true)
as
select r.*, public.effective_round_status(r) as status
from public.rounds r;

comment on view public.rounds_with_status is
  'App code queries this, not rounds directly, so effective status never '
  'needs recomputing client-side. security_invoker = true so it inherits '
  'the caller''s RLS rather than the view owner''s.';

-- ---------------------------------------------------------------------------
-- Stage rounds — which rounds contribute to a stage aggregate, and at what
-- admin-configurable weight (resolves "different rounds, different score
-- scales" without guessing a normalization rule).
-- ---------------------------------------------------------------------------

create table public.stage_rounds (
  stage_id uuid not null references public.stages (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  weight numeric(6, 3) not null default 1,
  primary key (stage_id, round_id)
);

comment on table public.stage_rounds is
  'SCR-01/02: join table wiring rounds into a stage aggregate at an '
  'admin-set weight — e.g. the quiz''s raw scale vs Round 2''s rubric max.';

alter table public.stage_rounds enable row level security;

create policy "stage_rounds_admin_all"
  on public.stage_rounds for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Round materials — brief/files/instructions/rubric, publishable to anon
-- only once the parent round itself is publicly released (RND-06/RND-07).
-- ---------------------------------------------------------------------------

create table public.round_materials (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  kind text not null check (kind in ('file', 'link', 'text')),
  title text not null,
  storage_path text,
  url text,
  body text,
  public_release boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint round_materials_payload_matches_kind check (
    (kind = 'file' and storage_path is not null)
    or (kind = 'link' and url is not null)
    or (kind = 'text' and body is not null)
  )
);

comment on table public.round_materials is
  'RND-07: written brief, downloadable files, instructions/guidelines and '
  'rubric are all one kind-tagged row here.';

create trigger set_updated_at
  before update on public.round_materials
  for each row execute function public.set_updated_at();

alter table public.round_materials enable row level security;

create policy "round_materials_select_authenticated"
  on public.round_materials for select
  to authenticated
  using (true);

create policy "round_materials_select_public_released"
  on public.round_materials for select
  to anon
  using (
    public_release
    and exists (
      select 1 from public.rounds r
      where r.id = round_materials.round_id and r.public_released_at is not null
    )
  );

create policy "round_materials_admin_write"
  on public.round_materials for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Submissions and submission files — SUB-01..09, §9.1
-- ---------------------------------------------------------------------------

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  status text not null default 'not_submitted' check (status in ('not_submitted', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submissions_round_team_unique unique (round_id, team_id)
);

comment on table public.submissions is
  'One row per (round, team). submitted_at is a server timestamp (RND-08), '
  'never client-supplied.';

create trigger set_updated_at
  before update on public.submissions
  for each row execute function public.set_updated_at();

alter table public.submissions enable row level security;

create policy "submissions_select_own_or_admin"
  on public.submissions for select
  to authenticated
  using (team_id = (select auth.uid()) or public.is_admin());

create policy "submissions_admin_write"
  on public.submissions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  uploaded_at timestamptz not null default now(),
  superseded_at timestamptz
);

comment on table public.submission_files is
  'SUB-02/03: multiple files per submission. A "replace" stamps '
  'superseded_at on the prior set and inserts fresh rows in the same '
  'transaction (submit_round_files below) — "current files" is always '
  'where superseded_at is null.';

create index submission_files_current_idx
  on public.submission_files (submission_id)
  where superseded_at is null;

alter table public.submission_files enable row level security;

-- §9.1: teams cannot download their files after the round closes — this is
-- an RLS condition, not just client-side hiding.
create policy "submission_files_select_own_or_admin"
  on public.submission_files for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.submissions s
      join public.rounds r on r.id = s.round_id
      where s.id = submission_files.submission_id
        and s.team_id = (select auth.uid())
        and public.effective_round_status(r) <> 'closed'
    )
  );

create policy "submission_files_admin_write"
  on public.submission_files for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Rubric criteria and scores — SCR-06, SUB-06/07
-- ---------------------------------------------------------------------------

create table public.rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  label text not null,
  max_value numeric(8, 2) not null check (max_value > 0),
  weight numeric(6, 3) not null default 1,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rubric_criteria is
  'Visible to teams pre-submission (RND-07 lists the rubric as round '
  'material) — only the entered values are gated by publication.';

create trigger set_updated_at
  before update on public.rubric_criteria
  for each row execute function public.set_updated_at();

alter table public.rubric_criteria enable row level security;

create policy "rubric_criteria_select_authenticated"
  on public.rubric_criteria for select
  to authenticated
  using (true);

create policy "rubric_criteria_admin_write"
  on public.rubric_criteria for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  total numeric(10, 2) not null default 0,
  max_total numeric(10, 2),
  -- The highest-value column in this migration: without it, Phase 4's
  -- auto-scored quiz and Phase 5's simulation-reward marks have nowhere
  -- uniform to land, and a stage aggregate would silently omit whichever
  -- round wrote somewhere else.
  source text not null default 'manual' check (source in ('manual', 'quiz', 'simulation')),
  published boolean not null default false,
  notes text,
  entered_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scores_round_team_unique unique (round_id, team_id)
);

comment on table public.scores is
  'SCR-05: only admin enters/edits/publishes (manual source), or a '
  'service_role RPC on behalf of an automated round (quiz/simulation). '
  'A team only ever sees its own row once published = true (SUB-07).';

create trigger set_updated_at
  before update on public.scores
  for each row execute function public.set_updated_at();

alter table public.scores enable row level security;

create policy "scores_select_own_published_or_admin"
  on public.scores for select
  to authenticated
  using ((team_id = (select auth.uid()) and published) or public.is_admin());

create policy "scores_admin_write"
  on public.scores for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table public.score_criterion_values (
  id uuid primary key default gen_random_uuid(),
  score_id uuid not null references public.scores (id) on delete cascade,
  criterion_id uuid not null references public.rubric_criteria (id) on delete cascade,
  value numeric(8, 2) not null,
  constraint score_criterion_values_unique unique (score_id, criterion_id)
);

alter table public.score_criterion_values enable row level security;

create policy "score_criterion_values_select_own_published_or_admin"
  on public.score_criterion_values for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.scores sc
      where sc.id = score_criterion_values.score_id
        and sc.team_id = (select auth.uid())
        and sc.published
    )
  );

create policy "score_criterion_values_admin_write"
  on public.score_criterion_values for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Stage adjustments — the seam that lets Phase 5's simulation-reward marks
-- (SCR-03) add to a stage aggregate without stage_standings() ever needing
-- to know simulation_rewards exists.
-- ---------------------------------------------------------------------------

create table public.stage_adjustments (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  amount numeric(10, 2) not null,
  reason text not null,
  source_ref text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

comment on table public.stage_adjustments is
  'Append-only ad-hoc additions to a stage aggregate — e.g. a simulation '
  'marks reward. source_ref is a free-form pointer (e.g. a '
  'simulation_reward id) for audit, with no FK to keep this migration '
  'independent of Phase 5.';

alter table public.stage_adjustments enable row level security;

create policy "stage_adjustments_admin_all"
  on public.stage_adjustments for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Qualifications — the manual gate in §12.2 step 4. Ranking alone never
-- sets decision.
-- ---------------------------------------------------------------------------

create table public.qualifications (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  rank int,
  aggregate_snapshot jsonb not null default '{}'::jsonb,
  -- Load-bearing across Phases 5 and 6 (simulation eligibility, auction/
  -- analytics access) — adding a fourth value later is cheap; redefining
  -- what 'qualified' means is not.
  decision text not null default 'pending' check (decision in ('pending', 'qualified', 'eliminated')),
  decided_at timestamptz,
  decided_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qualifications_stage_team_unique unique (stage_id, team_id)
);

comment on table public.qualifications is
  'DASH-05: a team sees its own decision + rank at any time, not gated by '
  'publication — only the *public* leaderboard is publication-gated.';

create trigger set_updated_at
  before update on public.qualifications
  for each row execute function public.set_updated_at();

alter table public.qualifications enable row level security;

create policy "qualifications_select_own_or_admin"
  on public.qualifications for select
  to authenticated
  using (team_id = (select auth.uid()) or public.is_admin());

create policy "qualifications_admin_write"
  on public.qualifications for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Leaderboard snapshots — append-only publication history (§20.1: "preserve
-- publication snapshots so prior published states can be audited").
-- Publishing writes a new snapshot; hiding only stamps hidden_at on the
-- currently-live one. Nothing is ever mutated in place.
-- ---------------------------------------------------------------------------

create table public.leaderboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  kind text not null check (kind in ('top_15', 'final_top_10')),
  entry_limit int not null,
  published_at timestamptz not null default now(),
  hidden_at timestamptz,
  published_by uuid references auth.users (id)
);

comment on table public.leaderboard_snapshots is
  'LDB-04/07: entering scores never moves this. Exactly one live '
  '(hidden_at is null) snapshot per kind at a time — publishing a new one '
  'hides the previous automatically.';

alter table public.leaderboard_snapshots enable row level security;

create policy "leaderboard_snapshots_select_live"
  on public.leaderboard_snapshots for select
  to anon, authenticated
  using (hidden_at is null);

create policy "leaderboard_snapshots_select_admin_all"
  on public.leaderboard_snapshots for select
  to authenticated
  using (public.is_admin());

create policy "leaderboard_snapshots_admin_write"
  on public.leaderboard_snapshots for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table public.leaderboard_snapshot_entries (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.leaderboard_snapshots (id) on delete cascade,
  rank int not null,
  team_name text not null,
  score numeric(10, 2) not null,
  constraint leaderboard_snapshot_entries_unique unique (snapshot_id, rank)
);

comment on table public.leaderboard_snapshot_entries is
  'Columns are copied at publish time, not joined live (SEC-11: team name '
  'only, never register numbers/emails/phones), so history reads correctly '
  'even if a team is later renamed.';

alter table public.leaderboard_snapshot_entries enable row level security;

create policy "leaderboard_snapshot_entries_select_live"
  on public.leaderboard_snapshot_entries for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.leaderboard_snapshots s
      where s.id = leaderboard_snapshot_entries.snapshot_id and s.hidden_at is null
    )
  );

create policy "leaderboard_snapshot_entries_select_admin_all"
  on public.leaderboard_snapshot_entries for select
  to authenticated
  using (public.is_admin());

create policy "leaderboard_snapshot_entries_admin_write"
  on public.leaderboard_snapshot_entries for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Announcements — DASH-07, dashboard-only, no email/WhatsApp integration.
-- ---------------------------------------------------------------------------

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  audience text not null check (audience in ('all', 'team', 'public')),
  message text not null,
  visibility text not null default 'draft' check (visibility in ('draft', 'published')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

alter table public.announcements enable row level security;

create policy "announcements_select_public"
  on public.announcements for select
  to anon
  using (visibility = 'published' and audience in ('all', 'public'));

create policy "announcements_select_team_or_admin"
  on public.announcements for select
  to authenticated
  using ((visibility = 'published' and audience in ('all', 'team')) or public.is_admin());

create policy "announcements_admin_write"
  on public.announcements for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage — private "submissions" bucket, same shape as "invoices" (002),
-- plus the §9.1 "no download after close" rule expressed as an RLS
-- condition rather than only client-side hiding.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;

create policy "submissions_bucket_select_own_or_admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'submissions'
    and (
      public.is_admin()
      or (
        (storage.foldername(name))[1] = (select auth.uid()::text)
        and exists (
          select 1 from public.rounds r
          where r.id::text = (storage.foldername(name))[2]
            and public.effective_round_status(r) <> 'closed'
        )
      )
    )
  );

-- Uploads go through the service-role admin client from a Server Action
-- (same pattern as invoices), so only admin needs a direct object-write
-- policy here.
create policy "submissions_bucket_admin_write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'submissions' and public.is_admin());

create policy "submissions_bucket_admin_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'submissions' and public.is_admin())
  with check (bucket_id = 'submissions' and public.is_admin());

create policy "submissions_bucket_admin_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'submissions' and public.is_admin());

-- ---------------------------------------------------------------------------
-- can_team_submit() — separates "Open — eligible" from "Open — view only"
-- (§8.1) without a second status word. security definer so it can read
-- teams/qualifications regardless of RLS, but guards its own callers so a
-- team cannot probe another team's eligibility.
-- ---------------------------------------------------------------------------

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
  v_decision text;
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

  if v_round.requires_qualification_from_stage is not null then
    select decision into v_decision
    from public.qualifications
    where stage_id = v_round.requires_qualification_from_stage and team_id = p_team_id;

    if v_decision is distinct from 'qualified' then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on function public.can_team_submit(uuid, uuid) is
  'RND-03/DASH-06: false for disqualified teams, unqualified-stage teams, '
  'or a round that is not currently open — regardless of which reason, '
  'the UI shows "Open — view only" rather than an enabled submit control.';

-- ---------------------------------------------------------------------------
-- submit_round_files() — the one atomic RPC behind a team's submission.
-- Re-checks eligibility and the deadline inside the transaction (AT-RND-02:
-- reject after server close even if the page was left open).
-- ---------------------------------------------------------------------------

create or replace function public.submit_round_files(
  p_team_id uuid,
  p_round_id uuid,
  p_files jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_submission_id uuid;
  v_file jsonb;
begin
  select * into v_round from public.rounds where id = p_round_id;
  if v_round.id is null then
    raise exception '[not_found] Round not found.';
  end if;

  if not public.can_team_submit(p_round_id, p_team_id) then
    raise exception '[submission_not_allowed] This round is not open for submission by your team.';
  end if;

  if p_files is null or jsonb_array_length(p_files) < 1 then
    raise exception '[no_files] At least one file is required.';
  end if;

  insert into public.submissions (round_id, team_id, status, submitted_at)
  values (p_round_id, p_team_id, 'submitted', now())
  on conflict (round_id, team_id)
    do update set status = 'submitted', submitted_at = now()
  returning id into v_submission_id;

  -- Whole-set replacement (adopted default): supersede everything currently
  -- live before inserting the new set, in the same transaction.
  update public.submission_files
  set superseded_at = now()
  where submission_id = v_submission_id and superseded_at is null;

  for v_file in select * from jsonb_array_elements(p_files) loop
    insert into public.submission_files (submission_id, storage_path, file_name, mime_type)
    values (
      v_submission_id,
      v_file ->> 'storage_path',
      v_file ->> 'file_name',
      v_file ->> 'mime_type'
    );
  end loop;

  perform public.log_activity(
    v_round.event_edition_id, p_team_id, 'team', 'round_submitted',
    jsonb_build_object('round_id', p_round_id, 'file_count', jsonb_array_length(p_files))
  );

  return v_submission_id;
end;
$$;

comment on function public.submit_round_files(uuid, uuid, jsonb) is
  'AT-RND-02/03, SUB-02/03/05: called from a Server Action after files are '
  'already uploaded to the "submissions" storage bucket via the admin '
  'client — same order as register_team().';

-- ---------------------------------------------------------------------------
-- Round admin CRUD
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_round(
  p_round_id uuid,
  p_expected_updated_at timestamptz,
  p_event_edition_id uuid,
  p_kind text,
  p_sequence int,
  p_slug text,
  p_title text,
  p_brief text,
  p_instructions text,
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_requires_qualification_from_stage uuid,
  p_rubric_total_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round_id uuid;
  v_actual_updated_at timestamptz;
begin
  if p_kind not in ('quiz', 'submission', 'offline_info', 'simulation', 'auction', 'conference') then
    raise exception '[invalid_kind] Unknown round kind.';
  end if;

  if p_round_id is not null then
    select updated_at into v_actual_updated_at from public.rounds where id = p_round_id;
    if v_actual_updated_at is null then
      raise exception '[not_found] Round not found.';
    end if;
    if p_expected_updated_at is not null and v_actual_updated_at <> p_expected_updated_at then
      raise exception '[stale_edit] This round was edited by someone else — refresh and try again.';
    end if;

    begin
      update public.rounds set
        kind = p_kind,
        sequence = p_sequence,
        slug = p_slug,
        title = p_title,
        brief = p_brief,
        instructions = p_instructions,
        opens_at = p_opens_at,
        closes_at = p_closes_at,
        requires_qualification_from_stage = p_requires_qualification_from_stage,
        rubric_total_mode = p_rubric_total_mode
      where id = p_round_id;
    exception when unique_violation then
      raise exception '[duplicate_round_slug] A round with this slug or sequence already exists.';
    end;

    v_round_id := p_round_id;
  else
    begin
      insert into public.rounds (
        event_edition_id, kind, sequence, slug, title, brief, instructions,
        opens_at, closes_at, requires_qualification_from_stage, rubric_total_mode
      ) values (
        p_event_edition_id, p_kind, p_sequence, p_slug, p_title, p_brief, p_instructions,
        p_opens_at, p_closes_at, p_requires_qualification_from_stage, p_rubric_total_mode
      )
      returning id into v_round_id;
    exception when unique_violation then
      raise exception '[duplicate_round_slug] A round with this slug or sequence already exists.';
    end;
  end if;

  return v_round_id;
end;
$$;

comment on function public.admin_upsert_round(uuid, timestamptz, uuid, text, int, text, text, text, text, timestamptz, timestamptz, uuid, text) is
  'ADM-03: admin round builder. ERR-07 optimistic concurrency on updates, '
  'same p_expected_updated_at shape as admin_update_team().';

create or replace function public.admin_set_round_lifecycle(p_round_id uuid, p_action text)
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
    update public.rounds set scoring_started_at = now() where id = p_round_id and scoring_started_at is null;

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

  else
    raise exception '[invalid_action] Unknown round lifecycle action.';
  end if;
end;
$$;

comment on function public.admin_set_round_lifecycle(uuid, text) is
  'RND-02/06: the one-way transitions (open early / close / start scoring '
  '/ mark scored / release publicly / archive). "close_now" never accepts '
  'a matching "reopen" action by design.';

create or replace function public.admin_upsert_round_material(
  p_material_id uuid,
  p_round_id uuid,
  p_kind text,
  p_title text,
  p_storage_path text,
  p_url text,
  p_body text,
  p_public_release boolean,
  p_position int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_kind not in ('file', 'link', 'text') then
    raise exception '[invalid_kind] Unknown material kind.';
  end if;
  if p_kind = 'file' and p_storage_path is null then
    raise exception '[invalid_material] A file material requires a storage path.';
  end if;
  if p_kind = 'link' and p_url is null then
    raise exception '[invalid_material] A link material requires a url.';
  end if;
  if p_kind = 'text' and p_body is null then
    raise exception '[invalid_material] A text material requires a body.';
  end if;

  if p_material_id is not null then
    update public.round_materials
    set kind = p_kind, title = p_title, storage_path = p_storage_path, url = p_url,
        body = p_body, public_release = p_public_release, position = p_position
    where id = p_material_id
    returning id into v_id;
    if v_id is null then
      raise exception '[not_found] Material not found.';
    end if;
  else
    insert into public.round_materials
      (round_id, kind, title, storage_path, url, body, public_release, position)
    values (p_round_id, p_kind, p_title, p_storage_path, p_url, p_body, p_public_release, p_position)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.admin_delete_round_material(p_material_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.round_materials where id = p_material_id;
$$;

create or replace function public.admin_upsert_rubric_criterion(
  p_criterion_id uuid,
  p_round_id uuid,
  p_label text,
  p_max_value numeric,
  p_weight numeric,
  p_position int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_max_value <= 0 then
    raise exception '[invalid_criterion] Max value must be greater than zero.';
  end if;

  if p_criterion_id is not null then
    update public.rubric_criteria
    set label = p_label, max_value = p_max_value, weight = p_weight, position = p_position
    where id = p_criterion_id
    returning id into v_id;
    if v_id is null then
      raise exception '[not_found] Criterion not found.';
    end if;
  else
    insert into public.rubric_criteria (round_id, label, max_value, weight, position)
    values (p_round_id, p_label, p_max_value, p_weight, p_position)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.admin_delete_rubric_criterion(p_criterion_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rubric_criteria where id = p_criterion_id;
$$;

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_score(
  p_round_id uuid,
  p_team_id uuid,
  p_expected_updated_at timestamptz,
  p_total numeric,
  p_max_total numeric,
  p_criterion_values jsonb,
  p_notes text
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

  -- Recomputed from criteria when rubric values are supplied, so a stray
  -- client-sent total can never disagree with its own breakdown (SCR-06).
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
  values (p_round_id, p_team_id, v_computed_total, p_max_total, 'manual', p_notes, auth.uid())
  on conflict (round_id, team_id)
    do update set total = v_computed_total, max_total = p_max_total, notes = p_notes,
                  entered_by = auth.uid(), updated_at = now()
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

comment on function public.admin_save_score(uuid, uuid, timestamptz, numeric, numeric, jsonb, text) is
  'SCR-05/06, ERR-07: same optimistic-concurrency shape as '
  'admin_update_team(). Publishing is a separate step below (LDB-04: '
  'entering scores never moves anything public).';

create or replace function public.admin_set_score_published(p_score_id uuid, p_published boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.scores set published = p_published, updated_at = now() where id = p_score_id;
$$;

create or replace function public.admin_publish_scores_for_round(p_round_id uuid)
returns int
language sql
security definer
set search_path = ''
as $$
  update public.scores set published = true, updated_at = now()
  where round_id = p_round_id and published = false;
  select count(*)::int from public.scores where round_id = p_round_id and published;
$$;

-- ---------------------------------------------------------------------------
-- Stage aggregation and tie-breakers
-- ---------------------------------------------------------------------------

create or replace function public.stage_standings(p_stage_id uuid)
returns table (team_id uuid, team_name citext, aggregate numeric, rank int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule1 jsonb;
  v_rule2 jsonb;
begin
  select tie_breaker_rules -> 0, tie_breaker_rules -> 1
  into v_rule1, v_rule2
  from public.stages where id = p_stage_id;

  return query
  with round_scores as (
    select sr.round_id, sr.weight
    from public.stage_rounds sr
    where sr.stage_id = p_stage_id
  ),
  weighted as (
    select t.id as team_id,
           coalesce(sum(s.total * rs.weight), 0) as weighted_total
    from public.teams t
    cross join round_scores rs
    left join public.scores s on s.round_id = rs.round_id and s.team_id = t.id
    group by t.id
  ),
  adjustments as (
    -- Table-qualified: stage_standings' OUT parameter is also named
    -- team_id, and PL/pgSQL treats a bare column reference here as
    -- ambiguous between the two rather than resolving it to the table.
    select stage_adjustments.team_id, sum(amount) as adj_total
    from public.stage_adjustments
    where stage_id = p_stage_id
    group by stage_adjustments.team_id
  ),
  tie1 as (
    select s.team_id, s.total as v
    from public.scores s
    where v_rule1 is not null
      and v_rule1 ->> 'kind' = 'higher_round_score'
      and s.round_id = (v_rule1 ->> 'round_id')::uuid
  ),
  tie2 as (
    select sub.team_id, sub.submitted_at as v
    from public.submissions sub
    where v_rule2 is not null
      and v_rule2 ->> 'kind' = 'earlier_submission'
      and sub.round_id = (v_rule2 ->> 'round_id')::uuid
  )
  select
    w.team_id,
    tm.name,
    (w.weighted_total + coalesce(a.adj_total, 0))::numeric as aggregate,
    (rank() over (
      order by w.weighted_total + coalesce(a.adj_total, 0) desc,
               t1.v desc nulls last,
               t2.v asc nulls last
    ))::int as rank
  from weighted w
  join public.teams tm on tm.id = w.team_id
  left join adjustments a on a.team_id = w.team_id
  left join tie1 t1 on t1.team_id = w.team_id
  left join tie2 t2 on t2.team_id = w.team_id
  order by aggregate desc;
end;
$$;

comment on function public.stage_standings(uuid) is
  'SCR-01/02/07: a team with no score for a contributing round is ranked '
  'with that component as 0, never silently excluded. Tie-breaker rules '
  'are a small closed vocabulary (see stages.tie_breaker_rules), not open '
  'SQL — "higher_round_score" and "earlier_submission" are the only kinds '
  'understood here today.';

create or replace function public.admin_set_stage_rounds(p_stage_id uuid, p_round_weights jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rw jsonb;
begin
  delete from public.stage_rounds where stage_id = p_stage_id;
  for v_rw in select * from jsonb_array_elements(p_round_weights) loop
    insert into public.stage_rounds (stage_id, round_id, weight)
    values (p_stage_id, (v_rw ->> 'round_id')::uuid, coalesce((v_rw ->> 'weight')::numeric, 1));
  end loop;
end;
$$;

create or replace function public.admin_add_stage_adjustment(
  p_stage_id uuid,
  p_team_id uuid,
  p_amount numeric,
  p_reason text,
  p_source_ref text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.stage_adjustments (stage_id, team_id, amount, reason, source_ref, created_by)
  values (p_stage_id, p_team_id, p_amount, p_reason, p_source_ref, auth.uid())
  returning id;
$$;

-- ---------------------------------------------------------------------------
-- Qualification confirmation — §12.2 step 4. Ranking alone never sets
-- decision; re-confirming after the next round has opened is allowed and
-- logged, a stage never hard-locks.
-- ---------------------------------------------------------------------------

create or replace function public.admin_confirm_qualifications(p_stage_id uuid, p_decisions jsonb)
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
    values (p_stage_id, v_standing.team_id, v_standing.rank, v_snapshot, v_decision, now(), auth.uid())
    on conflict (stage_id, team_id)
      do update set rank = excluded.rank, aggregate_snapshot = excluded.aggregate_snapshot,
                    decision = excluded.decision, decided_at = now(), decided_by = auth.uid();
  end loop;

  perform public.log_activity(
    (select event_edition_id from public.stages where id = p_stage_id),
    null, 'admin', 'qualifications_confirmed',
    jsonb_build_object('stage_id', p_stage_id, 'decisions', p_decisions)
  );
end;
$$;

comment on function public.admin_confirm_qualifications(uuid, jsonb) is
  'AT-SCR-02: manual confirmation, never automatic from ranking. '
  'Re-confirming after the next round has opened is allowed, logged to '
  'activity_events — a stage never hard-locks.';

-- ---------------------------------------------------------------------------
-- Leaderboard publication — immutable snapshots, hide-without-mutation.
-- ---------------------------------------------------------------------------

create or replace function public.admin_publish_leaderboard(
  p_event_edition_id uuid,
  p_kind text,
  p_entries jsonb,
  p_entry_limit int
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
  if p_kind not in ('top_15', 'final_top_10') then
    raise exception '[invalid_kind] Unknown leaderboard kind.';
  end if;

  -- Exactly one live board per kind — publishing a new one hides the
  -- previous automatically rather than requiring a separate hide call.
  update public.leaderboard_snapshots
  set hidden_at = now()
  where event_edition_id = p_event_edition_id and kind = p_kind and hidden_at is null;

  insert into public.leaderboard_snapshots (event_edition_id, kind, entry_limit, published_by)
  values (p_event_edition_id, p_kind, p_entry_limit, auth.uid())
  returning id into v_snapshot_id;

  -- p_entries for kind = 'final_top_10' is an explicit admin-ordered array
  -- (§18: "no unsupported assumption") — never computed here.
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

create or replace function public.admin_hide_leaderboard(p_snapshot_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.leaderboard_snapshots set hidden_at = now() where id = p_snapshot_id and hidden_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Announcements admin CRUD
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_announcement(
  p_announcement_id uuid,
  p_event_edition_id uuid,
  p_audience text,
  p_message text,
  p_visibility text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
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
    values (p_event_edition_id, p_audience, p_message, p_visibility, auth.uid())
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- pg_cron materializer — this project's first scheduled job. It writes only
-- an advisory activity-log line, never anything security-relevant: a missed
-- tick loses a log line, nothing else, per architecture principle #3.
-- ---------------------------------------------------------------------------

select cron.schedule(
  'materialize-round-status',
  '* * * * *',
  $cron$
  insert into public.activity_events (event_edition_id, team_id, actor_role, kind, detail)
  select r.event_edition_id, null, 'admin', 'round_status_transition',
         jsonb_build_object('round_id', r.id, 'status', public.effective_round_status(r))
  from public.rounds r
  where public.effective_round_status(r) in ('open', 'closed')
    and not exists (
      select 1 from public.activity_events e
      where e.kind = 'round_status_transition'
        and (e.detail ->> 'round_id')::uuid = r.id
        and (e.detail ->> 'status') = public.effective_round_status(r)
    );
  $cron$
);

-- ---------------------------------------------------------------------------
-- Grants — every mutation RPC is service_role only (same rationale as
-- migration 002: Supabase''s ALTER DEFAULT PRIVILEGES grants EXECUTE to
-- anon/authenticated directly, so "revoke ... from public" alone is not
-- enough). can_team_submit() is a documented exception, read-only and
-- self-guarded, granted to authenticated for direct dashboard use.
-- ---------------------------------------------------------------------------

revoke all on function public.can_team_submit(uuid, uuid) from public, anon;
grant execute on function public.can_team_submit(uuid, uuid) to authenticated;

revoke all on function public.submit_round_files(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_round_files(uuid, uuid, jsonb) to service_role;

revoke all on function public.admin_upsert_round(uuid, timestamptz, uuid, text, int, text, text, text, text, timestamptz, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_upsert_round(uuid, timestamptz, uuid, text, int, text, text, text, text, timestamptz, timestamptz, uuid, text) to service_role;

revoke all on function public.admin_set_round_lifecycle(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_round_lifecycle(uuid, text) to service_role;

revoke all on function public.admin_upsert_round_material(uuid, uuid, text, text, text, text, text, boolean, int) from public, anon, authenticated;
grant execute on function public.admin_upsert_round_material(uuid, uuid, text, text, text, text, text, boolean, int) to service_role;

revoke all on function public.admin_delete_round_material(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_round_material(uuid) to service_role;

revoke all on function public.admin_upsert_rubric_criterion(uuid, uuid, text, numeric, numeric, int) from public, anon, authenticated;
grant execute on function public.admin_upsert_rubric_criterion(uuid, uuid, text, numeric, numeric, int) to service_role;

revoke all on function public.admin_delete_rubric_criterion(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_rubric_criterion(uuid) to service_role;

revoke all on function public.admin_save_score(uuid, uuid, timestamptz, numeric, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_save_score(uuid, uuid, timestamptz, numeric, numeric, jsonb, text) to service_role;

revoke all on function public.admin_set_score_published(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_score_published(uuid, boolean) to service_role;

revoke all on function public.admin_publish_scores_for_round(uuid) from public, anon, authenticated;
grant execute on function public.admin_publish_scores_for_round(uuid) to service_role;

revoke all on function public.stage_standings(uuid) from public, anon, authenticated;
grant execute on function public.stage_standings(uuid) to service_role;

revoke all on function public.admin_set_stage_rounds(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_set_stage_rounds(uuid, jsonb) to service_role;

revoke all on function public.admin_add_stage_adjustment(uuid, uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.admin_add_stage_adjustment(uuid, uuid, numeric, text, text) to service_role;

revoke all on function public.admin_confirm_qualifications(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_confirm_qualifications(uuid, jsonb) to service_role;

revoke all on function public.admin_publish_leaderboard(uuid, text, jsonb, int) from public, anon, authenticated;
grant execute on function public.admin_publish_leaderboard(uuid, text, jsonb, int) to service_role;

revoke all on function public.admin_hide_leaderboard(uuid) from public, anon, authenticated;
grant execute on function public.admin_hide_leaderboard(uuid) to service_role;

revoke all on function public.admin_upsert_announcement(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_upsert_announcement(uuid, uuid, text, text, text) to service_role;

-- effective_round_status() stays PUBLIC-executable (default) like
-- is_registration_open() — read-only, deterministic, and in practice only
-- reachable through rounds_with_status, which itself carries RLS.

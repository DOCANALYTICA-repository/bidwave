-- Migration — seed the six brochure rounds
--
-- Phase 2 (public site) needs real `rounds` rows so /rounds/[slug] isn't
-- permanently empty and the admin has something to edit via /admin/rounds.
-- slugs here must exactly match src/lib/rounds-catalog.ts's ROUND_COPY
-- keys. opens_at/closes_at are left null (only day-level dates are known
-- from the brochure, not times) — every row starts life as 'draft' until
-- an admin sets real times.
--
-- kind mapping: quiz/auction/conference are certain (Phases 4/6/8 name
-- them explicitly); Rounds 2-4 use 'submission' per migration 003's own
-- header comment. Round 4 ("Crisis Room", a group discussion) may fit
-- 'offline_info' better in practice — flagged for the admin to correct via
-- /admin/rounds if so; low-stakes, easily changed later.
--
-- PRD references: PUB-02, RND-01.

set search_path = public, extensions;

insert into public.rounds (event_edition_id, kind, sequence, slug, title, brief)
select
  e.id,
  v.kind,
  v.sequence,
  v.slug,
  v.title,
  v.brief
from public.event_editions e
cross join (
  values
    ('quiz', 1, 'the-stat-sprint', 'The Stat Sprint',
     'A fast-paced IPL quiz testing cricketing knowledge, analytical thinking and composure under pressure — player statistics, historic milestones, iconic moments and franchise records.'),
    ('submission', 2, 'operation-fan-heist', 'Operation Fan Heist',
     'An immersive marketing simulation: step into the role of senior franchise executives and solve one of the toughest branding challenges in modern sport.'),
    ('submission', 3, 'the-immersive-challenge', 'The Immersive Challenge',
     'Bidwave''s most mysterious round — cutting-edge virtual reality blended with interactive gameplay.'),
    ('submission', 4, 'crisis-room', 'Crisis Room',
     'A group discussion round: dynamic conversations centered on cricket, sports management, business and current affairs across the IPL ecosystem.'),
    ('auction', 5, 'the-grand-auction', 'The Grand Auction',
     'The heart of Bidwave — assemble the ultimate squad from a dynamic pool of uncapped prospects, emerging talents and established stars.'),
    ('conference', 6, 'the-owners-summit', 'The Owners'' Summit',
     'Franchise owners take center stage before a live audience to justify the vision behind their auction strategy, player selections and franchise planning.')
) as v(kind, sequence, slug, title, brief)
where e.slug = 'bidwave-2026'
on conflict (event_edition_id, slug) do nothing;

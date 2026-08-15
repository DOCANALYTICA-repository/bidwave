-- ---------------------------------------------------------------------------
-- Fix a regression introduced by 20260814050000_quiz_retest_round.sql.
--
-- That migration rewrote stage_standings()'s `weighted` CTE from
--     from public.teams t cross join round_scores rs left join public.scores s
-- to
--     from public.teams t left join effective e on e.team_id = t.id
-- so that a team whose every contribution was filtered out by the new
-- supersede rule still ranks with 0 rather than vanishing (SCR-01/02/07).
--
-- That was right for the supersede case but changed behaviour for a stage
-- with NO stage_rounds rows at all. Under the CROSS JOIN, an empty
-- round_scores produced zero rows, so stage_standings() returned nothing.
-- Under the LEFT JOIN it returns every team in the edition at 0.
--
-- The 'final' stage has no stage_rounds by design — the final Top 10 is
-- curated by hand, never computed (see
-- 20260801130000_seed_stages_and_simulation_config.sql). Caught by diffing
-- stage_standings before/after on the live database: final went from 0 rows
-- to 95. Left alone it would have put all 95 teams, tied at rank 1, into
-- /admin/final-results and into admin_confirm_qualifications' loop.
--
-- Restores the "no contributing rounds -> no standings" contract with an
-- explicit guard, while keeping the supersede fix.
--
-- Verified after applying: standings for all four stages are byte-identical
-- to the pre-20260814050000 snapshot.
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
  v_event_edition_id uuid;
begin
  select tie_breaker_rules -> 0, tie_breaker_rules -> 1, event_edition_id
  into v_rule1, v_rule2, v_event_edition_id
  from public.stages where id = p_stage_id;

  -- A stage with no contributing rounds has no standings to compute. This
  -- is load-bearing for the 'final' stage, whose Top 10 is curated by hand.
  if not exists (select 1 from public.stage_rounds where stage_id = p_stage_id) then
    return;
  end if;

  return query
  with round_scores as (
    select sr.round_id, sr.weight, r.supersedes_round_id
    from public.stage_rounds sr
    join public.rounds r on r.id = sr.round_id
    where sr.stage_id = p_stage_id
  ),
  -- Rounds in THIS stage that some other round in this stage replaces.
  superseded as (
    select distinct rs.supersedes_round_id as round_id
    from round_scores rs
    where rs.supersedes_round_id is not null
  ),
  contributions as (
    select t.id as team_id, rs.round_id, rs.weight, coalesce(s.total, 0) as total
    from public.teams t
    cross join round_scores rs
    left join public.scores s on s.round_id = rs.round_id and s.team_id = t.id
    where t.event_edition_id = v_event_edition_id
  ),
  effective as (
    select c.*
    from contributions c
    where c.round_id not in (select sup.round_id from superseded sup)
       or not exists (
            select 1
            from round_scores rs2
            join public.scores s2
              on s2.round_id = rs2.round_id and s2.team_id = c.team_id
            where rs2.supersedes_round_id = c.round_id
          )
  ),
  weighted as (
    -- LEFT JOIN from teams rather than grouping over `effective`, so a team
    -- whose every contribution was filtered out by the supersede rule still
    -- ranks with 0 instead of vanishing from the standings (SCR-01/02/07).
    -- Safe now that the empty-stage case returns early above.
    select t.id as team_id,
           coalesce(sum(e.total * e.weight), 0) as weighted_total
    from public.teams t
    left join effective e on e.team_id = t.id
    where t.event_edition_id = v_event_edition_id
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

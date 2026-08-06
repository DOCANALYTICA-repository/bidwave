-- Phase 8 — REP-01..07: the "import errors" export needs a persisted
-- source. admin_import_players() (Phase 6) previously logged only the
-- error *count* into activity_events, discarding the per-row detail once
-- the RPC's live response was read — there was nothing left to re-export
-- later. This redefines the function, unchanged except logging the full
-- v_errors array (not just its length) into activity_events.detail.

create or replace function public.admin_import_players(
  p_event_edition_id uuid,
  p_round_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_stat_key text;
begin
  for v_row in select * from jsonb_array_elements(p_rows) loop
    begin
      insert into public.players (
        event_edition_id, round_id, external_ref, full_name, role, base_price,
        pool, nationality, ipl_team, is_overseas, stats
      ) values (
        p_event_edition_id, p_round_id, v_row ->> 'externalRef', v_row ->> 'fullName',
        v_row ->> 'role', (v_row ->> 'basePrice')::numeric, v_row ->> 'pool',
        v_row ->> 'nationality', v_row ->> 'iplTeam',
        coalesce(lower(v_row ->> 'nationality') <> 'india', false),
        coalesce(v_row -> 'stats', '{}'::jsonb)
      );
      v_inserted := v_inserted + 1;

      for v_stat_key in select jsonb_object_keys(coalesce(v_row -> 'stats', '{}'::jsonb)) loop
        insert into public.player_stat_definitions (event_edition_id, key, label, data_type)
        values (p_event_edition_id, v_stat_key, v_stat_key, 'text')
        on conflict (event_edition_id, key) do nothing;
      end loop;
    exception when unique_violation then
      v_errors := v_errors || jsonb_build_object(
        'external_ref', v_row ->> 'externalRef',
        'full_name', v_row ->> 'fullName',
        'error', 'duplicate_external_ref'
      );
    end;
  end loop;

  -- 'error_rows' persists the full array so a later export (REP-04) can
  -- rebuild the exact same CSV the admin saw live, instead of only a count.
  perform public.log_activity(
    p_event_edition_id, null, 'admin', 'players_imported',
    jsonb_build_object('inserted', v_inserted, 'errors', jsonb_array_length(v_errors), 'error_rows', v_errors)
  );

  return jsonb_build_object('inserted_count', v_inserted, 'errors', v_errors);
end;
$$;

comment on function public.admin_import_players(uuid, uuid, jsonb) is
  'AUC-05: deliberate exception to "zero partial writes" — the per-row '
  'begin/exception block means valid rows commit even when some rows are '
  'invalid, by design (the "zero partial writes" contract in AUC-10/AT-'
  'AUC-02 is scoped to sale-rule validation, a different operation). '
  'REP-04: full error detail also persisted to activity_events.detail.error_rows.';

-- ---------------------------------------------------------------------------
-- Stop editing a quiz question from destroying every recorded answer to it.
--
-- admin_upsert_quiz_question()'s edit path did:
--     delete from public.quiz_options where question_id = v_question_id;
-- and then re-inserted the options with fresh uuids. quiz_answers.option_id
-- references quiz_options(id) ON DELETE CASCADE, so that delete silently took
-- every team's answer to that question with it.
--
-- Observed on the live database: correcting the weight on two Stat Sprint
-- questions (positions 1 and 23) after the round had closed deleted 132
-- quiz_answers rows — 66 teams x 2 questions — turning "answered correctly"
-- into "never answered" for scoring purposes. The scores had already been
-- computed and published, so nothing surfaced the loss; it only appeared when
-- a recompute produced LOWER scores than the originals.
--
-- The fix: upsert options by (question_id, position) instead of
-- delete-then-insert, so an option's id — and therefore every quiz_answers
-- row pointing at it — survives an edit. Only genuinely removed trailing
-- positions are deleted, which is the one case where losing those answers is
-- the actual intent.
--
-- Editing prompt/timer/weight/is_active — the common case, and the only kind
-- of edit that happens after a round has run — is now completely non-
-- destructive.
--
-- Signature is unchanged, so the existing grants still apply. Body is
-- otherwise identical to 20260807090000 (option validation, advisory-locked
-- insert-path position calc).
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_quiz_question(
  p_question_id uuid,
  p_round_id uuid,
  p_position int,
  p_prompt text,
  p_timer_seconds int,
  p_weight numeric,
  p_is_active boolean,
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_id uuid;
  v_event_edition_id uuid;
  v_opt jsonb;
  v_next_position int;
  v_idx int;
begin
  select event_edition_id into v_event_edition_id from public.rounds where id = p_round_id;
  if v_event_edition_id is null then
    raise exception '[not_found] Round not found.';
  end if;

  if p_options is null or jsonb_array_length(p_options) < 2 then
    raise exception '[invalid_options] At least two options are required.';
  end if;

  if (select count(*) from jsonb_array_elements(p_options) o where (o ->> 'is_correct')::boolean) <> 1 then
    raise exception '[invalid_options] Exactly one option must be marked correct.';
  end if;

  if p_question_id is not null then
    update public.quiz_questions
    set position = p_position, prompt = p_prompt, timer_seconds = p_timer_seconds,
        weight = p_weight, is_active = p_is_active
    where id = p_question_id
    returning id into v_question_id;
    if v_question_id is null then
      raise exception '[not_found] Question not found.';
    end if;

    -- Upsert in place, keyed on the (question_id, position) unique index, so
    -- each option keeps its id and quiz_answers.option_id stays valid. This
    -- is the whole point of this migration — see the header.
    v_idx := 0;
    for v_opt in select * from jsonb_array_elements(p_options) loop
      insert into public.quiz_options (question_id, position, label, is_correct)
      values (v_question_id, v_idx, v_opt ->> 'label', (v_opt ->> 'is_correct')::boolean)
      on conflict (question_id, position)
      do update set label = excluded.label, is_correct = excluded.is_correct;
      v_idx := v_idx + 1;
    end loop;

    -- Only trailing options the caller actually removed are deleted. Answers
    -- pointing at those do cascade away, which is correct: the option they
    -- referred to no longer exists.
    delete from public.quiz_options
    where question_id = v_question_id and position >= v_idx;

    return v_question_id;
  else
    -- FOR UPDATE is illegal alongside an aggregate — that is what
    -- 20260806120000 shipped, and it made every insert fail at runtime
    -- ("FOR UPDATE is not allowed with aggregate functions"). Row locks
    -- also cannot stop two concurrent inserts computing the same max+1
    -- anyway — there is no row to lock for the phantom row that hasn't
    -- been inserted yet. Serialize per-round with an advisory transaction
    -- lock instead. pg_catalog. qualification is required because this
    -- function runs with search_path = ''.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('public.quiz_questions.position:' || p_round_id::text, 0)
    );

    select coalesce(max(position) + 1, 0) into v_next_position
    from public.quiz_questions where round_id = p_round_id;

    insert into public.quiz_questions (
      round_id, event_edition_id, position, prompt, timer_seconds, weight, is_active
    )
    values (
      p_round_id, v_event_edition_id, v_next_position, p_prompt, p_timer_seconds, p_weight, p_is_active
    )
    returning id into v_question_id;

    v_idx := 0;
    for v_opt in select * from jsonb_array_elements(p_options) loop
      insert into public.quiz_options (question_id, position, label, is_correct)
      values (v_question_id, v_idx, v_opt ->> 'label', (v_opt ->> 'is_correct')::boolean);
      v_idx := v_idx + 1;
    end loop;

    return v_question_id;
  end if;
end;
$$;

comment on function public.admin_upsert_quiz_question(uuid, uuid, int, text, int, numeric, boolean, jsonb) is
  'A new question''s position is computed authoritatively here (max+1) under '
  'a per-round advisory transaction lock (20260807090000) — never a '
  'client-supplied position. Editing an existing question upserts its options '
  'by position rather than delete-then-insert (20260815090000), because the '
  'delete cascaded through quiz_answers.option_id and destroyed every '
  'recorded answer to that question — 132 answers were lost that way on the '
  'live Stat Sprint round before this was fixed.';

-- Fixes a real race in admin_upsert_quiz_question(): a NEW question's
-- position was entirely client-supplied (quiz-builder.tsx passes
-- `questions.length` from its own props), and quiz_questions has a hard
-- `unique (round_id, position)` constraint. Two "Add question" submissions
-- in quick succession — before the page has revalidated its `questions`
-- prop to reflect the first insert — both compute the same `position`,
-- and the second silently fails on the unique constraint. Confirmed by
-- direct e2e reproduction (adding two questions back-to-back on the same
-- round). Fixed by computing a new question's position authoritatively
-- from the current max in the table, ignoring the client-supplied value
-- for inserts; the client-supplied position is still honored for edits
-- (an explicit reorder of an existing row).
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
    delete from public.quiz_options where question_id = v_question_id;
  else
    select coalesce(max(position) + 1, 0) into v_next_position
    from public.quiz_questions where round_id = p_round_id
    for update;

    insert into public.quiz_questions (round_id, event_edition_id, position, prompt, timer_seconds, weight, is_active)
    values (p_round_id, v_event_edition_id, v_next_position, p_prompt, p_timer_seconds, p_weight, p_is_active)
    returning id into v_question_id;
  end if;

  for v_opt in select * from jsonb_array_elements(p_options) loop
    insert into public.quiz_options (question_id, position, label, is_correct)
    values (v_question_id, (v_opt ->> 'position')::int, v_opt ->> 'label', (v_opt ->> 'is_correct')::boolean);
  end loop;

  return v_question_id;
end;
$$;

comment on function public.admin_upsert_quiz_question(uuid, uuid, int, text, int, numeric, boolean, jsonb) is
  'A new question''s position is computed authoritatively here (max+1),
   not trusted from the client''s possibly-stale questions-prop snapshot —
   fixes a real unique-constraint race on quiz_questions_round_position_unique
   when two questions are added back-to-back. Position for an edit of an
   existing question is still the caller''s explicit choice.';

-- Fix the thumbnail CHECK: Postgres cannot count to 960 in a regex.
--
-- 002 wrote the constraint as `thumbnail ~ '^[0-7]{960}$'`, which looks right
-- and is not: Postgres's regex engine caps bounded repetition `{n}` at 255 and
-- rejects anything larger with "invalid repetition count(s)". (JavaScript has
-- no such limit, which is why the identical pattern in `domain/thumbnail.ts`
-- is fine.)
--
-- It also failed late rather than at migration time. `ADD COLUMN` left every
-- row NULL, and `thumbnail is null` short-circuits before the regex is ever
-- evaluated, so the DDL succeeded and the error only surfaced when the backfill
-- tried to write the first real value.
--
-- The same rule, split so neither half needs a large repetition count.

do $$
declare
  constraint_name text;
begin
  -- Found by definition rather than by name: 002 created it inline, so the
  -- name was auto-generated and guessing it would risk leaving the broken
  -- constraint in place alongside the new one.
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'archive_captures'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%thumbnail%'
  loop
    execute format('alter table archive_captures drop constraint %I', constraint_name);
  end loop;
end
$$;

alter table archive_captures
  add constraint archive_captures_thumbnail_check
  check (
    thumbnail is null
    or (length(thumbnail) = 960 and thumbnail ~ '^[0-7]+$')
  );

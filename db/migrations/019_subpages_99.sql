-- A page may hold up to 99 screens, not 26.
--
-- MAX_SUBPAGE in src/domain/subpages.ts goes from 26 to 99, and the columns
-- that 008 and 009 bounded to match it have to move with it — otherwise a 27th
-- screen saves in the live document and then fails every backup of that page.
--
-- The old checks were declared inline, so their names are whatever Postgres
-- generated. They are found by the one column they constrain rather than by an
-- assumed name: a guessed name that missed would leave the 26 in place and the
-- migration would still report success.

do $$
declare
  target record;
  old_check text;
begin
  for target in
    select * from (values
      ('published_pages', 'subpage'),
      ('live_pages',      'subpage'),
      ('live_pages',      'subpage_count'),
      ('showcase_pages',  'subpage')
    ) as t(tbl, col)
  loop
    for old_check in
      select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_attribute att on att.attrelid = rel.oid and att.attname = target.col
      where rel.relname = target.tbl
        and con.contype = 'c'
        and con.conkey = array[att.attnum]
    loop
      execute format('alter table %I drop constraint %I', target.tbl, old_check);
    end loop;

    execute format(
      'alter table %I add constraint %I check (%I between 1 and 99)',
      target.tbl, target.tbl || '_' || target.col || '_check', target.col
    );
  end loop;
end
$$;

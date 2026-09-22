-- Paste into the Supabase SQL Editor AFTER the migration. Everything runs in a
-- transaction that is rolled back, so it leaves no data behind. Each check
-- raises an exception on failure; success ends with the notice 'FNO RLS OK'.
begin;

-- Two fake auth users (rolled back at the end).
insert into auth.users (id, email, email_confirmed_at, aud, role)
values ('00000000-0000-0000-0000-00000000000a', 'a@test.local', now(), 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-00000000000b', 'b@test.local', now(), 'authenticated', 'authenticated');

insert into public.fno_areas (id, label, lat, lon, built_radius_mi, status)
values ('00000000-0000-0000-0000-0000000000a1', 'Test', 40, -83, 25, 'ready');
insert into public.fno_places (id, area_id, name, lat, lon, section, ai_stars)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Speakeasy', 40, -83, 'gems', 5),
       ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'Cat cafe', 40, -83, 'gems', 4);

-- Act as user A.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

insert into public.fno_profiles (user_id, handle, display_name, home_area_id)
values ('00000000-0000-0000-0000-00000000000a', 'user_a', 'A', '00000000-0000-0000-0000-0000000000a1');

do $$ begin
  -- A cannot create an AI guide.
  begin
    insert into public.fno_profiles (user_id, handle, display_name, is_ai_guide)
    values (null, 'fake_guide', 'Fake', true);
    raise exception 'FAIL: user created an AI guide';
  exception when insufficient_privilege or check_violation then null; end;

  -- A cannot write the catalogue.
  begin
    insert into public.fno_places (area_id, name, lat, lon, section, ai_stars)
    values ('00000000-0000-0000-0000-0000000000a1', 'Fake', 40, -83, 'fun', 5);
    raise exception 'FAIL: user wrote fno_places';
  exception when insufficient_privilege then null; end;

  -- A can add a place to their own list, rate it, write a private note.
  insert into public.fno_list_items (profile_id, place_id)
  values (public.fno_my_profile_id(), '00000000-0000-0000-0000-0000000000c1');
  insert into public.fno_ratings (profile_id, place_id, stars)
  values (public.fno_my_profile_id(), '00000000-0000-0000-0000-0000000000c1', 4);
  insert into public.fno_notes (profile_id, place_id, body)
  values (public.fno_my_profile_id(), '00000000-0000-0000-0000-0000000000c1', 'secret note');
end $$;

-- Act as user B.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
insert into public.fno_profiles (user_id, handle, display_name, home_area_id)
values ('00000000-0000-0000-0000-00000000000b', 'user_b', 'B', '00000000-0000-0000-0000-0000000000a1');

do $$
declare a_id uuid;
begin
  select id into a_id from public.fno_profiles where handle = 'user_a';

  -- B cannot see A's private note or rating.
  if exists (select 1 from public.fno_notes where profile_id = a_id) then
    raise exception 'FAIL: B read A''s private note';
  end if;
  if exists (select 1 from public.fno_ratings where profile_id = a_id) then
    raise exception 'FAIL: B read A''s rating';
  end if;

  -- B cannot write into A's list.
  begin
    insert into public.fno_list_items (profile_id, place_id)
    values (a_id, '00000000-0000-0000-0000-0000000000c2');
    raise exception 'FAIL: B wrote A''s list';
  exception when insufficient_privilege then null; end;

  -- B cannot follow as A.
  begin
    insert into public.fno_follows (follower_id, followee_id)
    values (a_id, public.fno_my_profile_id());
    raise exception 'FAIL: B followed as A';
  exception when insufficient_privilege then null; end;

  -- B can see A's public list, copy from it, and follow A.
  if not exists (select 1 from public.fno_list_items where profile_id = a_id) then
    raise exception 'FAIL: B cannot see A''s public list';
  end if;
  insert into public.fno_list_items (profile_id, place_id, copied_from_id)
  values (public.fno_my_profile_id(), '00000000-0000-0000-0000-0000000000c1', a_id);
  insert into public.fno_follows (follower_id, followee_id) values (public.fno_my_profile_id(), a_id);

  -- Stats view exposes the rating aggregate but not who rated.
  if (select rating_count from public.fno_place_stats
      where place_id = '00000000-0000-0000-0000-0000000000c1') <> 1 then
    raise exception 'FAIL: stats view rating_count';
  end if;

  -- Leaderboard: A has 1 copy + 3 for the follower = 4.
  if (select score from public.fno_leaderboard('00000000-0000-0000-0000-0000000000a1')
      where handle = 'user_a') <> 4 then
    raise exception 'FAIL: leaderboard score for A';
  end if;

  raise notice 'FNO RLS OK';
end $$;

rollback;

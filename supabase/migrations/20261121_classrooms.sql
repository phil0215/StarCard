-- 班级（Classroom）v2：真实的班级 + 密钥加入 + 学习量榜
-- 2026-11-21

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- 表
create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  name        text not null check (char_length(name) between 1 and 24),
  slogan      text not null default '',
  join_key    text not null unique,
  key_enabled boolean not null default true,
  daily_goal  int  not null default 30   check (daily_goal between 1 and 9999),
  total_goal  int  not null default 1000 check (total_goal between 10 and 9999999),
  max_members int  not null default 50   check (max_members between 2 and 500),
  ends_on     date,
  created_at  timestamptz not null default now()
);

create table if not exists public.class_members (
  class_id  uuid not null references public.classes(id) on delete cascade,
  user_id   uuid not null,
  nickname  text not null default '',
  role      text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);

create index if not exists class_members_user_idx on public.class_members (user_id);
create index if not exists classes_owner_idx on public.classes (owner_id);

-- 这些表只允许通过下面的函数访问，不开放直连
revoke all on public.classes from anon, authenticated;
revoke all on public.class_members from anon, authenticated;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;

-- ---------------------------------------------------------------- 密钥
-- 8 位，去掉容易看错的 0/O/1/I/L
create or replace function public.class_key_gen()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out_key  text;
  i        int;
begin
  loop
    out_key := '';
    for i in 1..8 loop
      out_key := out_key || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.classes where join_key = out_key);
  end loop;
  return out_key;
end;
$$;

-- ---------------------------------------------------------------- 建班
create or replace function public.class_create(
  p_name        text,
  p_slogan      text  default '',
  p_daily_goal  int   default 30,
  p_total_goal  int   default 1000,
  p_max_members int   default 50,
  p_ends_on     date  default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid     uuid := auth.uid();
  v_name  text := left(btrim(coalesce(p_name, '')), 24);
  v_key   text;
  c       public.classes;
  v_nick  text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_auth', 'msg', '请先登录');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_name', 'msg', '请填写班级名');
  end if;

  v_key := public.class_key_gen();

  insert into public.classes (owner_id, name, slogan, join_key, daily_goal, total_goal, max_members, ends_on)
  values (uid, v_name, left(btrim(coalesce(p_slogan, '')), 60), v_key,
          greatest(1, coalesce(p_daily_goal, 30)),
          greatest(10, coalesce(p_total_goal, 1000)),
          greatest(2, coalesce(p_max_members, 50)),
          p_ends_on)
  returning * into c;

  select coalesce(nullif(up.nickname, ''), p.display_name, '同学')
  into v_nick
  from (select 1) dummy
  left join public.user_profile up on up.user_id = uid
  left join public.profiles p on p.id = uid;

  insert into public.class_members (class_id, user_id, nickname, role)
  values (c.id, uid, coalesce(v_nick, '同学'), 'owner');

  return jsonb_build_object('ok', true, 'class', jsonb_build_object(
    'id', c.id, 'name', c.name, 'slogan', c.slogan, 'join_key', c.join_key,
    'daily_goal', c.daily_goal, 'total_goal', c.total_goal,
    'max_members', c.max_members, 'ends_on', c.ends_on, 'role', 'owner'
  ));
end;
$$;

-- ---------------------------------------------------------------- 加入
create or replace function public.class_join(p_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid     uuid := auth.uid();
  v_key   text := upper(regexp_replace(coalesce(p_key, ''), '[^A-Za-z0-9]', '', 'g'));
  c       public.classes;
  v_count int;
  v_nick  text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_auth', 'msg', '请先登录');
  end if;
  if length(v_key) <> 8 then
    return jsonb_build_object('ok', false, 'code', 'bad_key', 'msg', '密钥应为 8 位');
  end if;

  select * into c from public.classes where join_key = v_key;
  if c.id is null or not c.key_enabled then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'msg', '密钥无效或已停用');
  end if;
  if c.ends_on is not null and c.ends_on < current_date then
    return jsonb_build_object('ok', false, 'code', 'closed', 'msg', '这个班级已结束');
  end if;

  if exists (select 1 from public.class_members where class_id = c.id and user_id = uid) then
    return jsonb_build_object('ok', true, 'already', true,
      'class', jsonb_build_object('id', c.id, 'name', c.name));
  end if;

  select count(*) into v_count from public.class_members where class_id = c.id;
  if v_count >= c.max_members then
    return jsonb_build_object('ok', false, 'code', 'full', 'msg', '班级人数已满');
  end if;

  select coalesce(nullif(up.nickname, ''), p.display_name, '同学')
  into v_nick
  from (select 1) dummy
  left join public.user_profile up on up.user_id = uid
  left join public.profiles p on p.id = uid;

  insert into public.class_members (class_id, user_id, nickname, role)
  values (c.id, uid, coalesce(v_nick, '同学'), 'member');

  return jsonb_build_object('ok', true, 'already', false,
    'class', jsonb_build_object('id', c.id, 'name', c.name));
end;
$$;

-- ---------------------------------------------------------------- 我的班级
create or replace function public.class_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  out jsonb;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_auth');
  end if;

  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into out
  from (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'slogan', c.slogan, 'join_key', c.join_key,
      'key_enabled', c.key_enabled, 'daily_goal', c.daily_goal, 'total_goal', c.total_goal,
      'max_members', c.max_members, 'ends_on', c.ends_on, 'created_at', c.created_at,
      'role', cm.role,
      'member_count', (select count(*) from public.class_members m where m.class_id = c.id),
      'today_cards', coalesce((select sum(d.cards_reviewed + d.cards_new) from public.study_daily d
                               join public.class_members m on m.user_id = d.user_id
                              where m.class_id = c.id and d.study_date = current_date), 0),
      'my_today', coalesce((select sum(d.cards_reviewed + d.cards_new) from public.study_daily d
                             where d.user_id = uid and d.study_date = current_date), 0)
    ) as x
    from public.classes c
    join public.class_members cm on cm.class_id = c.id and cm.user_id = uid
  ) s;

  return jsonb_build_object('ok', true, 'classes', out);
end;
$$;

-- ---------------------------------------------------------------- 班级详情
create or replace function public.class_detail(p_class_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid    uuid := auth.uid();
  c      public.classes;
  v_role text;
  members jsonb;
  sums   jsonb;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_auth');
  end if;

  select * into c from public.classes where id = p_class_id;
  if c.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select role into v_role from public.class_members
   where class_id = c.id and user_id = uid;
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'not_member');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', m.user_id,
           'nickname', m.nickname,
           'role', m.role,
           'today', coalesce(t.today_cards, 0),
           'week',  coalesce(w.week_cards, 0),
           'total', coalesce(a.total_cards, 0),
           'streak', coalesce(s.streak_days, 0),
           'last_date', s.last_study_date
         ) order by coalesce(a.total_cards, 0) desc, m.joined_at), '[]'::jsonb) into members
  from public.class_members m
  left join lateral (
    select sum(d.cards_reviewed + d.cards_new) as today_cards
      from public.study_daily d
     where d.user_id = m.user_id and d.study_date = current_date
  ) t on true
  left join lateral (
    select sum(d.cards_reviewed + d.cards_new) as week_cards
      from public.study_daily d
     where d.user_id = m.user_id
       and d.study_date >= date_trunc('week', current_date)::date
  ) w on true
  left join lateral (
    select sum(d.cards_reviewed + d.cards_new) as total_cards
      from public.study_daily d
     where d.user_id = m.user_id
  ) a on true
  left join public.study_summary s on s.user_id = m.user_id
  where m.class_id = c.id;

  select jsonb_build_object(
    'today', coalesce((select sum(d.cards_reviewed + d.cards_new) from public.study_daily d
                        join public.class_members m on m.user_id = d.user_id
                       where m.class_id = c.id and d.study_date = current_date), 0),
    'week', coalesce((select sum(d.cards_reviewed + d.cards_new) from public.study_daily d
                       join public.class_members m on m.user_id = d.user_id
                      where m.class_id = c.id and d.study_date >= date_trunc('week', current_date)::date), 0),
    'total', coalesce((select sum(d.cards_reviewed + d.cards_new) from public.study_daily d
                        join public.class_members m on m.user_id = d.user_id
                       where m.class_id = c.id), 0)
  ) into sums;

  return jsonb_build_object('ok', true, 'class', jsonb_build_object(
    'id', c.id, 'name', c.name, 'slogan', c.slogan, 'join_key', c.join_key,
    'key_enabled', c.key_enabled, 'daily_goal', c.daily_goal, 'total_goal', c.total_goal,
    'max_members', c.max_members, 'ends_on', c.ends_on, 'created_at', c.created_at,
    'owner_id', c.owner_id, 'my_role', v_role), 'members', members, 'summary', sums);
end;
$$;

-- ---------------------------------------------------------------- 退班 / 换密钥 / 踢人
create or replace function public.class_leave(p_class_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); v_role text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'no_auth'); end if;
  select role into v_role from public.class_members where class_id = p_class_id and user_id = uid;
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'not_member'); end if;
  if v_role = 'owner' then
    return jsonb_build_object('ok', false, 'code', 'owner', 'msg', '班级创建者不能退出，可转让或解散');
  end if;
  delete from public.class_members where class_id = p_class_id and user_id = uid;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.class_new_key(p_class_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); c public.classes; v_key text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'no_auth'); end if;
  select * into c from public.classes where id = p_class_id;
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if c.owner_id <> uid then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  v_key := public.class_key_gen();
  update public.classes set join_key = v_key, key_enabled = true where id = c.id;
  return jsonb_build_object('ok', true, 'join_key', v_key);
end;
$$;

create or replace function public.class_kick(p_class_id uuid, p_user_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); c public.classes;
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'no_auth'); end if;
  select * into c from public.classes where id = p_class_id;
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if c.owner_id <> uid then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if p_user_id = c.owner_id then return jsonb_build_object('ok', false, 'code', 'owner'); end if;
  delete from public.class_members where class_id = p_class_id and user_id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.class_key_gen() to authenticated;
grant execute on function public.class_create(text, text, int, int, int, date) to authenticated;
grant execute on function public.class_join(text) to authenticated;
grant execute on function public.class_mine() to authenticated;
grant execute on function public.class_detail(uuid) to authenticated;
grant execute on function public.class_leave(uuid) to authenticated;
grant execute on function public.class_new_key(uuid) to authenticated;
grant execute on function public.class_kick(uuid, uuid) to authenticated;

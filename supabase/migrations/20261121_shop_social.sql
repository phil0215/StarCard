-- 商铺 v2：真实上架 / 点赞 / 关注
-- 2026-11-21
-- 复用已有的 public.store_decks（creator_id / title / description / tags / card_count /
-- content / status / downloads），补上价格与详细介绍，再加点赞、关注两张表。

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- 补列
alter table public.store_decks
  add column if not exists price  int  not null default 60,
  add column if not exists detail text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'store_decks_price_check'
  ) then
    alter table public.store_decks
      add constraint store_decks_price_check check (price between 0 and 999);
  end if;
end;
$$;

create index if not exists store_decks_pub_idx
  on public.store_decks (status, created_at desc);

-- ---------------------------------------------------------------- 点赞 / 关注
create table if not exists public.shop_likes (
  deck_id uuid not null references public.store_decks(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (deck_id, user_id)
);

create table if not exists public.shop_follows (
  follower_id uuid not null,
  followee_id uuid not null,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint shop_follows_self check (follower_id <> followee_id)
);

create index if not exists shop_likes_user_idx on public.shop_likes (user_id);
create index if not exists shop_follows_followee_idx on public.shop_follows (followee_id);

-- 只允许通过下面的函数访问，不开放直连
revoke all on public.store_decks from anon, authenticated;
revoke all on public.shop_likes   from anon, authenticated;
revoke all on public.shop_follows from anon, authenticated;
alter table public.store_decks  enable row level security;
alter table public.shop_likes    enable row level security;
alter table public.shop_follows  enable row level security;

-- ---------------------------------------------------------------- 作者信息
-- 昵称优先 user_profile.nickname，其次 profiles.display_name，都没有就「同学」
create or replace function public.shop_author(p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id',    p_uid,
    'name',  coalesce(
               nullif((select nickname from public.user_profile where user_id = p_uid), ''),
               nullif((select display_name from public.profiles where id = p_uid), ''),
               '同学'),
    'handle', coalesce((select handle from public.profiles where id = p_uid), ''),
    'bio',   coalesce((select bio from public.profiles where id = p_uid), ''),
    'color', coalesce((select avatar_color from public.user_profile where user_id = p_uid), 0)
  );
$$;

-- ---------------------------------------------------------------- 列表
-- 商城列表：不带正文，只带封面需要的字段。登出也能逛。
create or replace function public.shop_list(p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(s.x order by s.sales desc nulls last, s.cat desc)
      from (
        select jsonb_build_object(
                 'id',         d.id,
                 'title',      d.title,
                 'intro',      coalesce(d.description, ''),
                 'detail',     coalesce(d.detail, ''),
                 'tags',       coalesce(to_jsonb(d.tags), '[]'::jsonb),
                 'category',   coalesce(d.category, ''),
                 'price',      d.price,
                 'card_count', d.card_count,
                 'sales',      coalesce(d.downloads, 0),
                 'created_at', d.created_at,
                 'author',     public.shop_author(d.creator_id),
                 'likes',      (select count(*) from public.shop_likes l where l.deck_id = d.id),
                 'mine',       (uid is not null and d.creator_id = uid),
                 'liked',      (uid is not null and exists (
                                  select 1 from public.shop_likes l2
                                  where l2.deck_id = d.id and l2.user_id = uid)),
                 'following',  (uid is not null and exists (
                                  select 1 from public.shop_follows f
                                  where f.follower_id = uid and f.followee_id = d.creator_id))
               ) as x,
               coalesce(d.downloads, 0) as sales,
               d.created_at as cat
        from public.store_decks d
        where d.status = 'published'
        order by d.created_at desc
        limit lim
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

-- 我的：自己上架的（含草稿 / 已下架）＋ 我关注的人
create or replace function public.shop_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  out_items jsonb;
  out_following jsonb;
  out_stats jsonb;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_auth', 'msg', '请先登录');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'title', d.title,
           'intro', coalesce(d.description, ''),
           'detail', coalesce(d.detail, ''),
           'price', d.price, 'card_count', d.card_count,
           'sales', coalesce(d.downloads, 0),
           'status', d.status, 'created_at', d.created_at,
           'likes', (select count(*) from public.shop_likes l where l.deck_id = d.id)
         ) order by d.created_at desc), '[]'::jsonb)
    into out_items
    from public.store_decks d
   where d.creator_id = uid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.followee_id,
           'author', public.shop_author(f.followee_id),
           'decks', (select count(*) from public.store_decks d
                      where d.creator_id = f.followee_id and d.status = 'published'),
           'since', f.created_at
         ) order by f.created_at desc), '[]'::jsonb)
    into out_following
    from public.shop_follows f
   where f.follower_id = uid;

  select jsonb_build_object(
           'followers', (select count(*) from public.shop_follows where followee_id = uid),
           'following', (select count(*) from public.shop_follows where follower_id = uid),
           'decks',     (select count(*) from public.store_decks where creator_id = uid and status = 'published'),
           'likes',     (select count(*) from public.shop_likes l
                          join public.store_decks d on d.id = l.deck_id
                         where d.creator_id = uid))
    into out_stats;

  return jsonb_build_object('ok', true, 'items', out_items,
                            'following_list', out_following, 'stats', out_stats);
end;
$$;

-- ---------------------------------------------------------------- 详情
create or replace function public.shop_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  d   public.store_decks;
begin
  select * into d from public.store_decks where id = p_id and status = 'published';
  if d.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'msg', '这件作品不在了');
  end if;

  return jsonb_build_object(
    'ok', true,
    'item', jsonb_build_object(
      'id', d.id, 'title', d.title,
      'intro', coalesce(d.description, ''),
      'detail', coalesce(d.detail, ''),
      'tags', coalesce(to_jsonb(d.tags), '[]'::jsonb),
      'price', d.price, 'card_count', d.card_count,
      'sales', coalesce(d.downloads, 0),
      'created_at', d.created_at,
      'author', public.shop_author(d.creator_id),
      'likes', (select count(*) from public.shop_likes l where l.deck_id = d.id),
      'mine',  (uid is not null and d.creator_id = uid),
      'liked', (uid is not null and exists (
                  select 1 from public.shop_likes l2
                  where l2.deck_id = d.id and l2.user_id = uid)),
      'following', (uid is not null and exists (
                      select 1 from public.shop_follows f
                      where f.follower_id = uid and f.followee_id = d.creator_id)),
      'author_stats', jsonb_build_object(
         'decks',     (select count(*) from public.store_decks x
                        where x.creator_id = d.creator_id and x.status = 'published'),
         'likes',     (select count(*) from public.shop_likes l
                        join public.store_decks x on x.id = l.deck_id
                       where x.creator_id = d.creator_id),
         'followers', (select count(*) from public.shop_follows f
                        where f.followee_id = d.creator_id))
    )
  );
end;
$$;

-- ---------------------------------------------------------------- 上架 / 改
create or replace function public.shop_publish(
  p_title      text,
  p_intro      text default '',
  p_detail     text default '',
  p_price      int  default 60,
  p_category   text default '词库',
  p_card_count int  default 0,
  p_content    text default ''
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid    uuid := auth.uid();
  v_title text := left(btrim(coalesce(p_title, ''), ' \n\t'), 40);
  v_price int  := coalesce(p_price, 60);
  new_id uuid;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_auth', 'msg', '请先登录再上架');
  end if;
  if v_title = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_title', 'msg', '作品名不能空着');
  end if;
  if v_price < 0 or v_price > 999 then
    return jsonb_build_object('ok', false, 'code', 'bad_price', 'msg', '价格要在 0–999 积分之间');
  end if;
  if coalesce(p_content, '') = '' then
    return jsonb_build_object('ok', false, 'code', 'empty', 'msg', '这套牌组还没有卡片');
  end if;

  -- 作者档案兜底：有些账号还没写过 profiles，先补一行，避免外键拦掉上架
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  -- 同一作者同名的在售作品，只做覆盖，避免刷出一堆重复
  select id into new_id from public.store_decks
   where creator_id = uid and title = v_title and status = 'published'
   limit 1;

  if new_id is null then
    insert into public.store_decks
      (creator_id, title, description, detail, price, tags, category,
       card_count, content, status, downloads)
    values
      (uid, v_title, left(coalesce(p_intro, ''), 120), left(coalesce(p_detail, ''), 4000),
       v_price, '{}', coalesce(nullif(p_category, ''), '词库'),
       coalesce(p_card_count, 0), p_content, 'published', 0)
    returning id into new_id;
  else
    update public.store_decks
       set description = left(coalesce(p_intro, ''), 120),
           detail      = left(coalesce(p_detail, ''), 4000),
           price       = v_price,
           card_count  = coalesce(p_card_count, card_count),
           content     = p_content,
           category    = coalesce(nullif(p_category, ''), category),
           status      = 'published',
           updated_at  = now()
     where id = new_id and creator_id = uid;
  end if;

  return jsonb_build_object('ok', true, 'id', new_id, 'msg', '已上架');
end;
$$;

create or replace function public.shop_update(
  p_id     uuid,
  p_title  text default null,
  p_intro  text default null,
  p_detail text default null,
  p_price  int  default null,
  p_status text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_auth', 'msg', '请先登录');
  end if;
  if p_status is not null and p_status not in ('draft', 'published', 'removed') then
    return jsonb_build_object('ok', false, 'code', 'bad_status', 'msg', '状态不合法');
  end if;
  if p_price is not null and (p_price < 0 or p_price > 999) then
    return jsonb_build_object('ok', false, 'code', 'bad_price', 'msg', '价格要在 0–999 积分之间');
  end if;

  update public.store_decks d set
    title       = coalesce(nullif(left(btrim(coalesce(p_title, ''), ' \n\t'), 40), ''), d.title),
    description = coalesce(left(p_intro, 120), d.description),
    detail      = coalesce(left(p_detail, 4000), d.detail),
    price       = coalesce(p_price, d.price),
    status      = coalesce(p_status, d.status),
    updated_at  = now()
  where d.id = p_id and d.creator_id = uid;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_mine', 'msg', '这不是你的作品');
  end if;
  return jsonb_build_object('ok', true, 'msg', '已更新');
end;
$$;

-- ---------------------------------------------------------------- 点赞 / 关注
create or replace function public.shop_like(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid   uuid := auth.uid();
  likes int;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_auth', 'msg', '登录后才能点赞');
  end if;
  if not exists (select 1 from public.store_decks where id = p_id and status = 'published') then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'msg', '这件作品不在了');
  end if;

  if exists (select 1 from public.shop_likes where deck_id = p_id and user_id = uid) then
    delete from public.shop_likes where deck_id = p_id and user_id = uid;
    select count(*) into likes from public.shop_likes where deck_id = p_id;
    return jsonb_build_object('ok', true, 'liked', false, 'likes', likes);
  end if;

  insert into public.shop_likes (deck_id, user_id) values (p_id, uid)
  on conflict do nothing;
  select count(*) into likes from public.shop_likes where deck_id = p_id;
  return jsonb_build_object('ok', true, 'liked', true, 'likes', likes);
end;
$$;

create or replace function public.shop_follow(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid       uuid := auth.uid();
  followers int;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_auth', 'msg', '登录后才能关注');
  end if;
  if p_user is null or p_user = uid then
    return jsonb_build_object('ok', false, 'code', 'self', 'msg', '不能关注自己');
  end if;

  if exists (select 1 from public.shop_follows where follower_id = uid and followee_id = p_user) then
    delete from public.shop_follows where follower_id = uid and followee_id = p_user;
    select count(*) into followers from public.shop_follows where followee_id = p_user;
    return jsonb_build_object('ok', true, 'following', false, 'followers', followers);
  end if;

  insert into public.shop_follows (follower_id, followee_id) values (uid, p_user)
  on conflict do nothing;
  select count(*) into followers from public.shop_follows where followee_id = p_user;
  return jsonb_build_object('ok', true, 'following', true, 'followers', followers);
end;
$$;

-- ---------------------------------------------------------------- 取正文（购买）
create or replace function public.shop_get(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  d   public.store_decks;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_auth', 'msg', '请先登录');
  end if;
  select * into d from public.store_decks where id = p_id and status = 'published';
  if d.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'msg', '这件作品不在了');
  end if;

  update public.store_decks set downloads = coalesce(downloads, 0) + 1 where id = p_id;

  return jsonb_build_object('ok', true, 'title', d.title, 'content', d.content);
end;
$$;

-- ---------------------------------------------------------------- 权限
grant execute on function public.shop_author(uuid)      to anon, authenticated;
grant execute on function public.shop_list(int)         to anon, authenticated;
grant execute on function public.shop_detail(uuid)      to anon, authenticated;
grant execute on function public.shop_mine()            to authenticated;
grant execute on function public.shop_publish(text, text, text, int, text, int, text) to authenticated;
grant execute on function public.shop_update(uuid, text, text, text, int, text)        to authenticated;
grant execute on function public.shop_like(uuid)        to authenticated;
grant execute on function public.shop_follow(uuid)      to authenticated;
grant execute on function public.shop_get(uuid)         to authenticated;

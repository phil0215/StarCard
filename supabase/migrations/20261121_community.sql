-- ============================================================
-- 闪星卡 · 社区（帖子 / 评论 / 点赞 / 同桌邀请）
-- 目标项目：aqsbrjiiudrqhqazvipj（StarCard）
-- 前端只用 publishable key + 登录后的 access_token 直连 REST，
-- 因此所有权限都靠 RLS 收口：公开可读、只有本人能写自己的行。
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------ 帖子
create table if not exists public.community_posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references auth.users(id) on delete cascade,
  author_name   text not null default '学习者',
  avatar_color  int  not null default 0,
  kind          text not null default 'post' check (kind in ('post', 'resource')),
  title         text not null default '',
  body          text not null default '',
  deck_name     text not null default '',
  deck_words    int  not null default 0,
  resource_path text not null default '',
  resource_size bigint not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists community_posts_created_idx on public.community_posts (created_at desc);
create index if not exists community_posts_author_idx  on public.community_posts (author_id);

-- ------------------------------------------------------------ 评论
create table if not exists public.community_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.community_posts(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  author_name text not null default '学习者',
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists community_comments_post_idx on public.community_comments (post_id, created_at);

-- ------------------------------------------------------------ 点赞
create table if not exists public.community_likes (
  post_id    uuid not null references public.community_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ------------------------------------------------------------ 同桌邀请
create table if not exists public.deskmate_invites (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references auth.users(id) on delete cascade,
  from_name    text not null default '学习者',
  to_user      uuid not null references auth.users(id) on delete cascade,
  message      text not null default '',
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint deskmate_invites_no_self check (from_user <> to_user)
);
create index if not exists deskmate_invites_to_idx on public.deskmate_invites (to_user, status);
create unique index if not exists deskmate_invites_pending_uniq
  on public.deskmate_invites (from_user, to_user) where status = 'pending';

-- ============================================================
-- RLS
-- ============================================================
alter table public.community_posts    enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_likes    enable row level security;
alter table public.deskmate_invites   enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.community_posts, public.community_comments, public.community_likes to anon, authenticated;
grant insert, update, delete on public.community_posts, public.community_comments to authenticated;
grant insert, delete on public.community_likes to authenticated;
grant select, insert, update on public.deskmate_invites to authenticated;

-- 帖子：所有人可看；只能以自己身份发；只能改/删自己的
drop policy if exists community_posts_read   on public.community_posts;
drop policy if exists community_posts_insert on public.community_posts;
drop policy if exists community_posts_update on public.community_posts;
drop policy if exists community_posts_delete on public.community_posts;
create policy community_posts_read   on public.community_posts for select using (true);
create policy community_posts_insert on public.community_posts for insert to authenticated with check (author_id = auth.uid());
create policy community_posts_update on public.community_posts for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy community_posts_delete on public.community_posts for delete to authenticated using (author_id = auth.uid());

-- 评论：所有人可看；只能发自己的；只能删自己的
drop policy if exists community_comments_read   on public.community_comments;
drop policy if exists community_comments_insert on public.community_comments;
drop policy if exists community_comments_delete on public.community_comments;
create policy community_comments_read   on public.community_comments for select using (true);
create policy community_comments_insert on public.community_comments for insert to authenticated with check (author_id = auth.uid());
create policy community_comments_delete on public.community_comments for delete to authenticated using (author_id = auth.uid());

-- 点赞：所有人可看计数；只能点/取消自己的
drop policy if exists community_likes_read   on public.community_likes;
drop policy if exists community_likes_insert on public.community_likes;
drop policy if exists community_likes_delete on public.community_likes;
create policy community_likes_read   on public.community_likes for select using (true);
create policy community_likes_insert on public.community_likes for insert to authenticated with check (user_id = auth.uid());
create policy community_likes_delete on public.community_likes for delete to authenticated using (user_id = auth.uid());

-- 同桌邀请：只有收发双方能看到；发起人写、收件人答复
drop policy if exists deskmate_invites_read   on public.deskmate_invites;
drop policy if exists deskmate_invites_insert on public.deskmate_invites;
drop policy if exists deskmate_invites_update on public.deskmate_invites;
create policy deskmate_invites_read on public.deskmate_invites for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());
create policy deskmate_invites_insert on public.deskmate_invites for insert to authenticated
  with check (from_user = auth.uid());
create policy deskmate_invites_update on public.deskmate_invites for update to authenticated
  using (from_user = auth.uid() or to_user = auth.uid())
  with check (from_user = auth.uid() or to_user = auth.uid());

-- 项目默认权限会把 TRUNCATE 也授给 anon/authenticated，而 RLS 管不到 TRUNCATE，收回来
revoke truncate on public.community_posts    from anon, authenticated;
revoke truncate on public.community_comments from anon, authenticated;
revoke truncate on public.community_likes    from anon, authenticated;
revoke truncate on public.deskmate_invites   from anon, authenticated;

-- ============================================================
-- 存储桶：社区分享的词库文件（.srcd，本质是 JSON）
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community', 'community', true, 5242880, array['application/json', 'text/plain'])
on conflict (id) do update set public = true, file_size_limit = 5242880;

drop policy if exists community_objects_read   on storage.objects;
drop policy if exists community_objects_insert on storage.objects;
drop policy if exists community_objects_delete on storage.objects;
create policy community_objects_read on storage.objects for select
  using (bucket_id = 'community');
create policy community_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'community' and owner = auth.uid());
create policy community_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'community' and owner = auth.uid());

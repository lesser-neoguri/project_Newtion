-- =====================================================================
-- Newtion: Notion-like collaborative workspace — initial schema
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null default '',
  avatar_color text not null default '#6366f1',
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  colors text[] := array['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#6366f1','#a855f7','#ec4899'];
begin
  insert into public.profiles (id, email, display_name, avatar_color)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    colors[1 + floor(random() * array_length(colors, 1))::int]
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Workspaces & membership
-- ---------------------------------------------------------------------
create type public.member_role as enum ('owner', 'editor', 'viewer');

create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  icon       text not null default '🎮',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.member_role not null default 'editor',
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email        text not null,
  role         public.member_role not null default 'editor',
  invited_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (workspace_id, email)
);
create index workspace_invites_email_idx on public.workspace_invites (lower(email));

-- Membership helpers (security definer so RLS policies don't recurse)
create or replace function public.is_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_edit(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
      and m.role in ('owner', 'editor')
  );
$$;

create or replace function public.is_owner(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

-- Users who share at least one workspace can see each other's profile
create or replace function public.shares_workspace(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = (select auth.uid()) and b.user_id = other
  );
$$;

-- ---------------------------------------------------------------------
-- Pages (documents, databases and database rows are all pages)
-- ---------------------------------------------------------------------
create type public.page_kind as enum ('doc', 'database', 'row');

create table public.pages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_id    uuid references public.pages (id) on delete cascade,
  kind         public.page_kind not null default 'doc',
  title        text not null default '',
  icon         text,
  cover        text,
  -- BlockNote JSON snapshot (used for previews, search and first load)
  content      jsonb not null default '[]'::jsonb,
  -- Yjs document state (base64) — source of truth for real-time editing
  ydoc         text,
  -- database pages: { properties: [...], views: [...] }
  db_schema    jsonb,
  -- row pages: { [propertyId]: value }
  properties   jsonb not null default '{}'::jsonb,
  position     double precision not null default extract(epoch from now()),
  archived_at  timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  updated_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index pages_workspace_idx on public.pages (workspace_id);
create index pages_parent_idx on public.pages (parent_id);
create index pages_title_trgm_idx on public.pages using gin (to_tsvector('simple', title));

create or replace function public.touch_page()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

create trigger pages_touch
  before update on public.pages
  for each row execute function public.touch_page();

-- Archiving / restoring a page cascades to its descendants
create or replace function public.set_page_archived(p_page uuid, p_archived boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  with recursive tree as (
    select id from public.pages where id = p_page
    union all
    select c.id from public.pages c join tree t on c.parent_id = t.id
  )
  update public.pages
     set archived_at = case when p_archived then now() else null end
   where id in (select id from tree);
end;
$$;

-- Merge a single property into a database row (avoids clobbering concurrent edits)
create or replace function public.set_row_property(p_page uuid, p_key text, p_value jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.pages
     set properties = case
       when p_value is null or p_value = 'null'::jsonb then properties - p_key
       else properties || jsonb_build_object(p_key, p_value)
     end
   where id = p_page;
$$;

-- ---------------------------------------------------------------------
-- Favorites & comments
-- ---------------------------------------------------------------------
create table public.page_favorites (
  user_id    uuid not null references auth.users (id) on delete cascade,
  page_id    uuid not null references public.pages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, page_id)
);
create index page_favorites_page_idx on public.page_favorites (page_id);

create table public.comments (
  id           uuid primary key default gen_random_uuid(),
  page_id      uuid not null references public.pages (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  body         text not null check (length(body) between 1 and 5000),
  resolved     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index comments_page_idx on public.comments (page_id);
create index comments_workspace_idx on public.comments (workspace_id);
create index comments_user_idx on public.comments (user_id);

-- Remaining FK indexes
create index workspaces_created_by_idx on public.workspaces (created_by);
create index workspace_invites_invited_by_idx on public.workspace_invites (invited_by);
create index pages_created_by_idx on public.pages (created_by);
create index pages_updated_by_idx on public.pages (updated_by);

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
create or replace function public.create_workspace(p_name text, p_icon text default '🎮')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;
  insert into public.workspaces (name, icon, created_by)
  values (p_name, coalesce(p_icon, '🎮'), (select auth.uid()))
  returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, (select auth.uid()), 'owner');
  return ws;
end;
$$;

-- Invite by email: adds immediately if the user exists, otherwise stores a pending invite
create or replace function public.invite_member(p_workspace uuid, p_email text, p_role public.member_role default 'editor')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not public.is_owner(p_workspace) then
    raise exception 'only owners can invite members';
  end if;
  select id into target from public.profiles where lower(email) = lower(trim(p_email));
  if target is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (p_workspace, target, p_role)
    on conflict (workspace_id, user_id) do update set role = excluded.role;
    return 'added';
  end if;
  insert into public.workspace_invites (workspace_id, email, role, invited_by)
  values (p_workspace, lower(trim(p_email)), p_role, (select auth.uid()))
  on conflict (workspace_id, email) do update set role = excluded.role;
  return 'invited';
end;
$$;

-- Called after login: turns pending invites for my email into memberships
create or replace function public.accept_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_email text;
  n integer;
begin
  select lower(email) into my_email from auth.users where id = (select auth.uid());
  if my_email is null then
    return 0;
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  select i.workspace_id, (select auth.uid()), i.role
  from public.workspace_invites i
  where lower(i.email) = my_email
  on conflict (workspace_id, user_id) do nothing;
  get diagnostics n = row_count;
  delete from public.workspace_invites where lower(email) = my_email;
  return n;
end;
$$;

revoke execute on function public.create_workspace(text, text) from anon;
revoke execute on function public.invite_member(uuid, text, public.member_role) from anon;
revoke execute on function public.accept_invites() from anon;
revoke execute on function public.set_page_archived(uuid, boolean) from anon;
revoke execute on function public.set_row_property(uuid, text, jsonb) from anon;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.pages             enable row level security;
alter table public.page_favorites    enable row level security;
alter table public.comments          enable row level security;

-- profiles
create policy "profiles: read self or teammates" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_workspace(id));
create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- workspaces
create policy "workspaces: members read" on public.workspaces
  for select to authenticated using (public.is_member(id));
create policy "workspaces: owners update" on public.workspaces
  for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));
create policy "workspaces: owners delete" on public.workspaces
  for delete to authenticated using (public.is_owner(id));

-- workspace_members
create policy "members: members read" on public.workspace_members
  for select to authenticated using (public.is_member(workspace_id));
create policy "members: owners update" on public.workspace_members
  for update to authenticated using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
create policy "members: owners remove or self leave" on public.workspace_members
  for delete to authenticated using (public.is_owner(workspace_id) or user_id = (select auth.uid()));

-- workspace_invites
create policy "invites: members read" on public.workspace_invites
  for select to authenticated using (public.is_member(workspace_id));
create policy "invites: owners delete" on public.workspace_invites
  for delete to authenticated using (public.is_owner(workspace_id));

-- pages
create policy "pages: members read" on public.pages
  for select to authenticated using (public.is_member(workspace_id));
create policy "pages: editors insert" on public.pages
  for insert to authenticated with check (public.can_edit(workspace_id) and created_by = (select auth.uid()));
create policy "pages: editors update" on public.pages
  for update to authenticated using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy "pages: editors delete" on public.pages
  for delete to authenticated using (public.can_edit(workspace_id));

-- favorites
create policy "favorites: own" on public.page_favorites
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- comments
create policy "comments: members read" on public.comments
  for select to authenticated using (public.is_member(workspace_id));
create policy "comments: members write" on public.comments
  for insert to authenticated with check (public.is_member(workspace_id) and user_id = (select auth.uid()));
create policy "comments: author or editor update" on public.comments
  for update to authenticated
  using (user_id = (select auth.uid()) or public.can_edit(workspace_id))
  with check (public.is_member(workspace_id));
create policy "comments: author or owner delete" on public.comments
  for delete to authenticated using (user_id = (select auth.uid()) or public.is_owner(workspace_id));

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.pages;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.workspace_members;

-- =====================================================================
-- Version map: branches per user, commit parents, AI commits, node comments
-- page_versions = commits. branch_id null → main line.
-- =====================================================================

-- ---------- branches ----------
create table public.page_branches (
  id                uuid primary key default gen_random_uuid(),
  page_id           uuid not null references public.pages (id) on delete cascade,
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  name              text not null check (length(name) between 1 and 60),
  owner_id          uuid not null references auth.users (id) on delete cascade,
  base_version_id   uuid,                       -- commit this branch was forked from
  title             text not null default '',
  content           jsonb not null default '[]'::jsonb,   -- working copy
  ydoc              text,
  status            text not null default 'open' check (status in ('open', 'merged', 'closed')),
  merged_version_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index page_branches_page_idx on public.page_branches (page_id);
create index page_branches_workspace_idx on public.page_branches (workspace_id);
create index page_branches_owner_idx on public.page_branches (owner_id);

-- ---------- commits ----------
alter table public.page_versions
  add column branch_id       uuid references public.page_branches (id) on delete cascade,
  add column parent_id       uuid references public.page_versions (id) on delete set null,
  add column merge_parent_id uuid references public.page_versions (id) on delete set null,
  add column actor           text not null default 'user' check (actor in ('user', 'ai')),
  add column actor_name      text;
alter table public.page_versions drop constraint page_versions_source_check;
alter table public.page_versions add constraint page_versions_source_check
  check (source in ('auto', 'manual', 'tidy', 'mcp', 'restore', 'commit', 'merge', 'fork'));
create index page_versions_branch_idx on public.page_versions (branch_id);
create index page_versions_parent_idx on public.page_versions (parent_id);
create index page_versions_merge_parent_idx on public.page_versions (merge_parent_id);

alter table public.page_branches
  add constraint page_branches_base_fk foreign key (base_version_id) references public.page_versions (id) on delete set null,
  add constraint page_branches_merged_fk foreign key (merged_version_id) references public.page_versions (id) on delete set null;
create index page_branches_base_idx on public.page_branches (base_version_id);
create index page_branches_merged_idx on public.page_branches (merged_version_id);

create or replace function public.touch_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger page_branches_touch before update on public.page_branches
  for each row execute function public.touch_branch();

alter table public.page_branches enable row level security;
create policy "branches: members read" on public.page_branches
  for select to authenticated using (public.is_member(workspace_id));
create policy "branches: editors create own" on public.page_branches
  for insert to authenticated with check (
    public.can_edit(workspace_id) and owner_id = (select auth.uid())
    and exists (select 1 from public.pages p where p.id = page_id and p.workspace_id = page_branches.workspace_id));
create policy "branches: owner edits" on public.page_branches
  for update to authenticated
  using (owner_id = (select auth.uid()) or public.is_owner(workspace_id))
  with check (public.can_edit(workspace_id));
create policy "branches: owner deletes" on public.page_branches
  for delete to authenticated using (owner_id = (select auth.uid()) or public.is_owner(workspace_id));

-- Commits on a branch may only be made by its owner (or a workspace owner).
drop policy "versions: editors save" on public.page_versions;
create policy "versions: editors save" on public.page_versions
  for insert to authenticated with check (
    public.can_edit(workspace_id)
    and saved_by = (select auth.uid())
    and exists (select 1 from public.pages p where p.id = page_id and p.workspace_id = page_versions.workspace_id)
    and (branch_id is null or exists (
      select 1 from public.page_branches b
      where b.id = branch_id and b.page_id = page_versions.page_id
        and (b.owner_id = (select auth.uid()) or public.is_owner(b.workspace_id))))
  );

-- ---------- node comments ----------
create table public.version_comments (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references public.page_versions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  body         text not null check (length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);
create index version_comments_version_idx on public.version_comments (version_id);
create index version_comments_workspace_idx on public.version_comments (workspace_id);
create index version_comments_user_idx on public.version_comments (user_id);
alter table public.version_comments enable row level security;
create policy "vcomments: members read" on public.version_comments
  for select to authenticated using (public.is_member(workspace_id));
create policy "vcomments: members write" on public.version_comments
  for insert to authenticated with check (
    public.is_member(workspace_id) and user_id = (select auth.uid())
    and exists (select 1 from public.page_versions v where v.id = version_id and v.workspace_id = version_comments.workspace_id));
create policy "vcomments: author or owner delete" on public.version_comments
  for delete to authenticated using (user_id = (select auth.uid()) or public.is_owner(workspace_id));

alter publication supabase_realtime add table public.page_versions;
alter publication supabase_realtime add table public.page_branches;
alter publication supabase_realtime add table public.version_comments;

-- ---------- MCP: AI edits are commits ----------
-- Records a commit made through MCP; actor = ai, actor_name = the token's name.
create or replace function public.mcp_create_version(
  p_token text, p_page uuid, p_title text, p_content jsonb, p_source text, p_label text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  ws uuid := public.mcp_check_page(uid, p_page, true);
  tname text;
  vid uuid;
begin
  select name into tname from public.api_tokens
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  insert into public.page_versions (page_id, workspace_id, title, content, source, label, edited_by, edited_at,
                                    saved_by, actor, actor_name)
  select p.id, ws, coalesce(p_title, p.title), coalesce(p_content, p.content), coalesce(p_source, 'mcp'), p_label,
         uid, now(), uid, 'ai', tname
  from public.pages p where p.id = p_page
  returning id into vid;
  perform public.trim_page_versions(p_page);
  return vid;
end;
$$;

create or replace function public.mcp_list_versions(p_token text, p_page uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
begin
  perform public.mcp_check_page(uid, p_page, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'created_at', v.created_at, 'source', v.source, 'label', v.label, 'title', v.title,
      'edited_by', pe.display_name, 'actor', v.actor, 'actor_name', v.actor_name,
      'branch', b.name, 'branch_owner', pb.display_name) order by v.created_at desc)
    from public.page_versions v
    left join public.profiles pe on pe.id = v.edited_by
    left join public.page_branches b on b.id = v.branch_id
    left join public.profiles pb on pb.id = b.owner_id
    where v.page_id = p_page), '[]'::jsonb);
end;
$$;

-- Trimming must never remove commits that branches or merges point at.
create or replace function public.trim_page_versions(p_page uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.page_versions v
   where v.id in (select id from public.page_versions where page_id = p_page and branch_id is null
                  order by created_at desc offset 200)
     and not exists (select 1 from public.page_branches b where b.base_version_id = v.id or b.merged_version_id = v.id)
     and not exists (select 1 from public.page_versions c where c.merge_parent_id = v.id or c.parent_id = v.id and c.branch_id is not null);
$$;
revoke execute on function public.trim_page_versions(uuid) from public, anon, authenticated;

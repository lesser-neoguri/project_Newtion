-- =====================================================================
-- Page version history
-- - auto:    when a page starts being edited again (>10 min since the last
--            version), the state *before* the edit is kept
-- - manual:  "save this version" with an optional name
-- - tidy / mcp / restore: kept right before an AI tidy, a Claude (MCP)
--            edit, or a restore replaces the content
-- =====================================================================

create table public.page_versions (
  id           uuid primary key default gen_random_uuid(),
  page_id      uuid not null references public.pages (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title        text not null default '',
  content      jsonb not null default '[]'::jsonb,
  source       text not null default 'auto' check (source in ('auto', 'manual', 'tidy', 'mcp', 'restore')),
  label        text check (label is null or length(label) <= 120),
  -- who last edited the page when it was in this state, and when
  edited_by    uuid references auth.users (id) on delete set null,
  edited_at    timestamptz not null default now(),
  -- who/what caused the snapshot
  saved_by     uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index page_versions_page_idx on public.page_versions (page_id, created_at desc);
create index page_versions_workspace_idx on public.page_versions (workspace_id);
create index page_versions_edited_by_idx on public.page_versions (edited_by);
create index page_versions_saved_by_idx on public.page_versions (saved_by);

alter table public.page_versions enable row level security;

create policy "versions: members read" on public.page_versions
  for select to authenticated using (public.is_member(workspace_id));
create policy "versions: editors save" on public.page_versions
  for insert to authenticated with check (
    public.can_edit(workspace_id)
    and saved_by = (select auth.uid())
    and exists (select 1 from public.pages p where p.id = page_id and p.workspace_id = page_versions.workspace_id)
  );
create policy "versions: owners delete" on public.page_versions
  for delete to authenticated using (public.is_owner(workspace_id));

-- Keep at most 200 versions per page.
create or replace function public.trim_page_versions(p_page uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.page_versions
   where id in (select id from public.page_versions where page_id = p_page order by created_at desc offset 200);
$$;
revoke execute on function public.trim_page_versions(uuid) from public, anon, authenticated;

-- Automatic snapshot of the previous state when editing resumes after a pause.
create or replace function public.page_auto_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'database' then return new; end if;
  if new.content is not distinct from old.content and new.title is not distinct from old.title then return new; end if;
  if old.content = '[]'::jsonb and old.title = '' then return new; end if;
  if exists (select 1 from public.page_versions v
              where v.page_id = old.id and v.created_at > now() - interval '10 minutes') then
    return new;
  end if;
  insert into public.page_versions (page_id, workspace_id, title, content, source, edited_by, edited_at, saved_by)
  values (old.id, old.workspace_id, old.title, old.content, 'auto', old.updated_by, old.updated_at,
          coalesce((select auth.uid()), new.updated_by));
  perform public.trim_page_versions(old.id);
  return new;
end;
$$;
revoke execute on function public.page_auto_version() from public, anon, authenticated;

create trigger pages_auto_version
  before update of content, title on public.pages
  for each row execute function public.page_auto_version();

-- ---------------------------------------------------------------------
-- MCP access (token-checked, like the other mcp_* functions)
-- ---------------------------------------------------------------------
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
  vid uuid;
begin
  insert into public.page_versions (page_id, workspace_id, title, content, source, label, edited_by, edited_at, saved_by)
  select p.id, ws, coalesce(p_title, p.title), coalesce(p_content, p.content), coalesce(p_source, 'mcp'), p_label,
         p.updated_by, p.updated_at, uid
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
      'id', v.id, 'created_at', v.created_at, 'edited_at', v.edited_at, 'source', v.source, 'label', v.label,
      'title', v.title, 'edited_by', pe.display_name, 'saved_by', ps.display_name) order by v.created_at desc)
    from public.page_versions v
    left join public.profiles pe on pe.id = v.edited_by
    left join public.profiles ps on ps.id = v.saved_by
    where v.page_id = p_page), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_get_version(p_token text, p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  pid uuid;
begin
  select page_id into pid from public.page_versions where id = p_version;
  if pid is null then
    raise exception 'version not found' using errcode = 'P0002';
  end if;
  perform public.mcp_check_page(uid, pid, false);
  return (select jsonb_build_object('id', id, 'page_id', page_id, 'title', title, 'content', content,
                                    'source', source, 'label', label, 'created_at', created_at)
          from public.page_versions where id = p_version);
end;
$$;

grant execute on function
  public.mcp_create_version(text, uuid, text, jsonb, text, text),
  public.mcp_list_versions(text, uuid),
  public.mcp_get_version(text, uuid)
to anon, authenticated;

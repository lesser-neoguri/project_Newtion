-- =====================================================================
-- Claude MCP access: personal API tokens + token-checked RPCs.
-- The MCP endpoint only has the publishable key; every function below
-- resolves the token to a user and enforces workspace permissions itself.
-- =====================================================================

create table public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null check (length(name) between 1 and 80),
  token_hash   text not null unique,
  token_prefix text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index api_tokens_user_idx on public.api_tokens (user_id);
alter table public.api_tokens enable row level security;

create policy "tokens: read own" on public.api_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy "tokens: delete own" on public.api_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- Creates a token for the signed-in user. The plain token is returned once and never stored.
create or replace function public.create_api_token(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok text;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;
  tok := 'nwt_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_tokens (user_id, name, token_hash, token_prefix)
  values ((select auth.uid()), coalesce(nullif(trim(p_name), ''), 'Claude'),
          encode(extensions.digest(tok, 'sha256'), 'hex'), left(tok, 12));
  return tok;
end;
$$;

-- ---------------------------------------------------------------------
-- Internal helpers (not callable through the API)
-- ---------------------------------------------------------------------
create or replace function public.mcp_user(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  h text := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
begin
  select user_id into uid from public.api_tokens where token_hash = h;
  if uid is null then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  update public.api_tokens set last_used_at = now()
   where token_hash = h and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return uid;
end;
$$;

create or replace function public.mcp_role(p_user uuid, p_ws uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.workspace_members where workspace_id = p_ws and user_id = p_user;
$$;

-- Raises unless the user is a member (p_edit: owner/editor) of the page's workspace. Returns the page's workspace.
create or replace function public.mcp_check_page(p_user uuid, p_page uuid, p_edit boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ws uuid;
  r public.member_role;
begin
  select workspace_id into ws from public.pages where id = p_page;
  if ws is null then
    raise exception 'page not found' using errcode = 'P0002';
  end if;
  r := public.mcp_role(p_user, ws);
  if r is null or (p_edit and r = 'viewer') then
    raise exception 'no permission' using errcode = '42501';
  end if;
  return ws;
end;
$$;

revoke execute on function public.mcp_user(text) from public, anon, authenticated;
revoke execute on function public.mcp_role(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.mcp_check_page(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.create_api_token(text) from public, anon;
grant execute on function public.create_api_token(text) to authenticated;

-- ---------------------------------------------------------------------
-- API used by /api/mcp
-- ---------------------------------------------------------------------
create or replace function public.mcp_whoami(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
begin
  return (select jsonb_build_object('user_id', p.id, 'name', p.display_name, 'email', p.email)
          from public.profiles p where p.id = uid);
end;
$$;

create or replace function public.mcp_list_workspaces(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'icon', w.icon, 'role', m.role) order by w.created_at)
    from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
    where m.user_id = uid), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_list_pages(p_token text, p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
begin
  if public.mcp_role(uid, p_workspace) is null then
    raise exception 'no permission' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'parent_id', parent_id, 'kind', kind, 'title', title,
                                        'icon', icon, 'updated_at', updated_at) order by position)
    from public.pages
    where workspace_id = p_workspace and kind <> 'row' and archived_at is null), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_search(p_token text, p_query text, p_workspace uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  q text := '%' || replace(replace(replace(coalesce(p_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  return coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object('id', p.id, 'workspace_id', p.workspace_id, 'workspace', w.name,
                                'kind', p.kind, 'title', p.title, 'parent_id', p.parent_id,
                                'match', case when p.title ilike q then 'title' else 'content' end) as x
      from public.pages p
      join public.workspace_members m on m.workspace_id = p.workspace_id and m.user_id = uid
      join public.workspaces w on w.id = p.workspace_id
      where p.archived_at is null
        and (p_workspace is null or p.workspace_id = p_workspace)
        and (p.title ilike q or p.content::text ilike q)
      order by (p.title ilike q) desc, p.updated_at desc
      limit 25) s), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_get_page(p_token text, p_page uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  ws uuid := public.mcp_check_page(uid, p_page, false);
begin
  return (
    select jsonb_build_object(
      'id', p.id, 'workspace_id', p.workspace_id, 'parent_id', p.parent_id, 'kind', p.kind,
      'title', p.title, 'icon', p.icon, 'content', p.content, 'ydoc', p.ydoc,
      'db_schema', p.db_schema, 'properties', p.properties, 'archived', p.archived_at is not null,
      'updated_at', p.updated_at, 'role', public.mcp_role(uid, ws),
      'parent_schema', (select pp.db_schema from public.pages pp where pp.id = p.parent_id and p.kind = 'row'),
      'members', (select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', pr.display_name, 'email', pr.email))
                  from public.workspace_members m join public.profiles pr on pr.id = m.user_id
                  where m.workspace_id = ws))
    from public.pages p where p.id = p_page);
end;
$$;

create or replace function public.mcp_list_rows(p_token text, p_database uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
begin
  perform public.mcp_check_page(uid, p_database, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'icon', icon, 'properties', properties) order by position)
    from public.pages where parent_id = p_database and kind = 'row' and archived_at is null), '[]'::jsonb);
end;
$$;

-- Save title / icon / content (+ Yjs state) / database schema. Null arguments leave a field unchanged.
create or replace function public.mcp_save_page(
  p_token text, p_page uuid,
  p_title text default null, p_icon text default null,
  p_content jsonb default null, p_ydoc text default null, p_db_schema jsonb default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  ts timestamptz;
begin
  perform public.mcp_check_page(uid, p_page, true);
  update public.pages set
    title = coalesce(p_title, title),
    icon = coalesce(p_icon, icon),
    content = coalesce(p_content, content),
    ydoc = coalesce(p_ydoc, ydoc),
    db_schema = coalesce(p_db_schema, db_schema),
    updated_by = uid
  where id = p_page
  returning updated_at into ts;
  return ts;
end;
$$;

create or replace function public.mcp_create_page(
  p_token text, p_workspace uuid, p_parent uuid, p_kind public.page_kind,
  p_title text, p_icon text default null, p_content jsonb default '[]'::jsonb,
  p_properties jsonb default '{}'::jsonb, p_db_schema jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  r public.member_role := public.mcp_role(uid, p_workspace);
  parent_kind public.page_kind;
  new_id uuid;
begin
  if r is null or r = 'viewer' then
    raise exception 'no permission' using errcode = '42501';
  end if;
  if p_parent is not null then
    select kind into parent_kind from public.pages where id = p_parent and workspace_id = p_workspace;
    if parent_kind is null then
      raise exception 'parent page not found in this workspace' using errcode = 'P0002';
    end if;
  end if;
  if p_kind = 'row' and parent_kind is distinct from 'database' then
    raise exception 'a database row needs a database as parent';
  end if;
  if p_kind <> 'row' and parent_kind is not distinct from 'database' then
    raise exception 'only rows can be created inside a database';
  end if;
  insert into public.pages (workspace_id, parent_id, kind, title, icon, content, properties, db_schema, created_by, updated_by)
  values (p_workspace, p_parent, p_kind, coalesce(p_title, ''), p_icon, coalesce(p_content, '[]'::jsonb),
          coalesce(p_properties, '{}'::jsonb), p_db_schema, uid, uid)
  returning id into new_id;
  return new_id;
end;
$$;

-- Merge properties into a database row; null values clear a property.
create or replace function public.mcp_set_row_properties(p_token text, p_row uuid, p_props jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  result jsonb;
begin
  perform public.mcp_check_page(uid, p_row, true);
  update public.pages
     set properties = jsonb_strip_nulls(properties || coalesce(p_props, '{}'::jsonb)), updated_by = uid
   where id = p_row and kind = 'row'
  returning properties into result;
  if result is null then
    raise exception 'not a database row' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create or replace function public.mcp_add_comment(p_token text, p_page uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  ws uuid := public.mcp_check_page(uid, p_page, false);
  new_id uuid;
begin
  insert into public.comments (page_id, workspace_id, user_id, body)
  values (p_page, ws, uid, left(p_body, 5000))
  returning id into new_id;
  return new_id;
end;
$$;

-- The MCP route calls these with the publishable key (anon); the token is the credential.
grant execute on function
  public.mcp_whoami(text),
  public.mcp_list_workspaces(text),
  public.mcp_list_pages(text, uuid),
  public.mcp_search(text, text, uuid),
  public.mcp_get_page(text, uuid),
  public.mcp_list_rows(text, uuid),
  public.mcp_save_page(text, uuid, text, text, jsonb, text, jsonb),
  public.mcp_create_page(text, uuid, uuid, public.page_kind, text, text, jsonb, jsonb, jsonb),
  public.mcp_set_row_properties(text, uuid, jsonb),
  public.mcp_add_comment(text, uuid, text)
to anon, authenticated;

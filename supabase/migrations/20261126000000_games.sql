-- =====================================================================
-- Web game builds (SDL2 / Emscripten output) shown next to design docs.
--   games         one per game, owned by a workspace
--   game_builds   one per uploaded version; files live in storage at games/<build_id>/<path>
--   pages.game_id the game shown next to a page
-- =====================================================================

create table public.games (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  name            text not null check (length(name) between 1 and 80),
  description     text,
  created_by      uuid references auth.users (id) on delete set null,
  latest_build_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index games_workspace_idx on public.games (workspace_id);
create index games_created_by_idx on public.games (created_by);

create table public.game_builds (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version      text not null check (length(version) between 1 and 60),
  notes        text,
  entry        text not null default 'index.html',
  files        jsonb not null default '[]'::jsonb,   -- [{path, size, type}]
  total_size   bigint not null default 0,
  status       text not null default 'uploading' check (status in ('uploading', 'ready')),
  uploaded_by  uuid references auth.users (id) on delete set null,
  actor        text not null default 'user' check (actor in ('user', 'ai')),
  actor_name   text,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index game_builds_game_idx on public.game_builds (game_id, created_at desc);
create index game_builds_workspace_idx on public.game_builds (workspace_id);
create index game_builds_uploaded_by_idx on public.game_builds (uploaded_by);

alter table public.games
  add constraint games_latest_build_fk foreign key (latest_build_id) references public.game_builds (id) on delete set null;
create index games_latest_build_idx on public.games (latest_build_id);

alter table public.pages add column game_id uuid references public.games (id) on delete set null;
create index pages_game_idx on public.pages (game_id);

create trigger games_touch before update on public.games
  for each row execute function public.touch_branch();

alter table public.games enable row level security;
create policy "games: members read" on public.games
  for select to authenticated using (public.is_member(workspace_id));
create policy "games: editors create" on public.games
  for insert to authenticated with check (public.can_edit(workspace_id) and created_by = (select auth.uid()));
create policy "games: editors update" on public.games
  for update to authenticated using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy "games: editors delete" on public.games
  for delete to authenticated using (public.can_edit(workspace_id));

alter table public.game_builds enable row level security;
create policy "builds: members read" on public.game_builds
  for select to authenticated using (public.is_member(workspace_id));
create policy "builds: editors create" on public.game_builds
  for insert to authenticated with check (
    public.can_edit(workspace_id) and uploaded_by = (select auth.uid()) and status = 'uploading' and actor = 'user'
    and exists (select 1 from public.games g where g.id = game_id and g.workspace_id = game_builds.workspace_id));
create policy "builds: editors edit notes" on public.game_builds
  for update to authenticated using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy "builds: editors delete" on public.game_builds
  for delete to authenticated using (public.can_edit(workspace_id));

alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_builds;

-- ---------------------------------------------------------------------
-- Storage: games/<build_id>/<path>, public read (opened through /g/<build>/...)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('games', 'games', true, 104857600)
on conflict (id) do nothing;

-- Build id from an object name, or null for anything that isn't "<uuid>/...".
create or replace function public.game_build_of(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  s text := split_part(p_name, '/', 1);
begin
  if s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return s::uuid; end if;
  return null;
end;
$$;

-- Files can only be added while a build is still being uploaded.
--   p_ai = false: a signed-in editor of the workspace (web upload)
--   p_ai = true : anyone holding the id of an AI build started through MCP within the last 2 hours
--                 (the unguessable build id is the upload capability; nothing else is writable)
create or replace function public.game_upload_open(p_name text, p_ai boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.game_builds b
    where b.id = public.game_build_of(p_name) and b.status = 'uploading'
      and case when p_ai then b.actor = 'ai' and b.created_at > now() - interval '2 hours'
               else public.can_edit(b.workspace_id) end);
$$;

create or replace function public.game_build_member(p_name text, p_edit boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.game_builds b
    where b.id = public.game_build_of(p_name)
      and case when p_edit then public.can_edit(b.workspace_id) else public.is_member(b.workspace_id) end);
$$;

create policy "games files: editors upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'games' and public.game_upload_open(name, false));
create policy "games files: ai upload" on storage.objects
  for insert to anon with check (bucket_id = 'games' and public.game_upload_open(name, true));
create policy "games files: members read" on storage.objects
  for select to authenticated using (bucket_id = 'games' and public.game_build_member(name, false));
create policy "games files: editors delete" on storage.objects
  for delete to authenticated using (bucket_id = 'games' and public.game_build_member(name, true));

-- ---------------------------------------------------------------------
-- Publishing: record the uploaded files and make the build the game's latest.
-- ---------------------------------------------------------------------
create or replace function public.game_build_publish_internal(p_build uuid, p_entry text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.game_builds;
  f jsonb;
  total bigint;
  v_entry text;
begin
  select * into b from public.game_builds where id = p_build;
  if b.id is null then raise exception 'build not found' using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'path', substr(o.name, length(p_build::text) + 2),
           'size', coalesce((o.metadata ->> 'size')::bigint, 0),
           'type', o.metadata ->> 'mimetype') order by o.name), '[]'::jsonb),
         coalesce(sum((o.metadata ->> 'size')::bigint), 0)
    into f, total
  from storage.objects o
  where o.bucket_id = 'games' and o.name like p_build::text || '/%';

  if jsonb_array_length(f) = 0 then
    raise exception 'no files uploaded for this build yet' using errcode = 'P0001';
  end if;

  -- Entry: the given one, else index.html, else the only .html file.
  v_entry := coalesce(nullif(trim(p_entry), ''), b.entry);
  if not exists (select 1 from jsonb_array_elements(f) e where e ->> 'path' = v_entry) then
    select e ->> 'path' into v_entry from jsonb_array_elements(f) e
     where e ->> 'path' ilike '%.html' order by (e ->> 'path' ilike '%index.html') desc, length(e ->> 'path') limit 1;
  end if;
  if v_entry is null then
    raise exception 'no .html entry file in this build (upload the Emscripten output including the .html)' using errcode = 'P0001';
  end if;

  update public.game_builds
     set files = f, total_size = total, entry = v_entry, status = 'ready', published_at = now()
   where id = p_build;
  update public.games set latest_build_id = p_build where id = b.game_id;
  return jsonb_build_object('id', p_build, 'game_id', b.game_id, 'version', b.version, 'entry', v_entry,
                            'files', jsonb_array_length(f), 'total_size', total);
end;
$$;
revoke execute on function public.game_build_publish_internal(uuid, text) from public, anon, authenticated;

-- Web: an editor finishes their own upload.
create or replace function public.publish_game_build(p_build uuid, p_entry text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare ws uuid;
begin
  select workspace_id into ws from public.game_builds where id = p_build;
  if ws is null or not public.can_edit(ws) then raise exception 'no permission' using errcode = '42501'; end if;
  return public.game_build_publish_internal(p_build, p_entry);
end;
$$;
revoke execute on function public.publish_game_build(uuid, text) from public, anon;
grant execute on function public.publish_game_build(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- MCP
-- ---------------------------------------------------------------------
create or replace function public.mcp_check_ws(p_user uuid, p_ws uuid, p_edit boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare r public.member_role := public.mcp_role(p_user, p_ws);
begin
  if r is null or (p_edit and r = 'viewer') then raise exception 'no permission' using errcode = '42501'; end if;
end;
$$;
revoke execute on function public.mcp_check_ws(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.mcp_list_games(p_token text, p_workspace uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := public.mcp_user(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name, 'workspace_id', g.workspace_id, 'workspace', w.name, 'description', g.description,
      'latest_version', lb.version, 'latest_build_id', g.latest_build_id,
      'builds', (select count(*) from public.game_builds b where b.game_id = g.id and b.status = 'ready'),
      'pages', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title)), '[]'::jsonb)
                from public.pages p where p.game_id = g.id and p.archived_at is null))
      order by g.updated_at desc)
    from public.games g
    join public.workspaces w on w.id = g.workspace_id
    left join public.game_builds lb on lb.id = g.latest_build_id
    where public.mcp_role(uid, g.workspace_id) is not null
      and (p_workspace is null or g.workspace_id = p_workspace)), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_create_game(p_token text, p_workspace uuid, p_name text, p_description text default null, p_page uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  gid uuid;
begin
  perform public.mcp_check_ws(uid, p_workspace, true);
  if p_page is not null and public.mcp_check_page(uid, p_page, true) <> p_workspace then
    raise exception 'the page is in another workspace' using errcode = 'P0001';
  end if;
  insert into public.games (workspace_id, name, description, created_by)
  values (p_workspace, left(trim(p_name), 80), p_description, uid) returning id into gid;
  if p_page is not null then update public.pages set game_id = gid where id = p_page; end if;
  return jsonb_build_object('id', gid, 'name', left(trim(p_name), 80));
end;
$$;

create or replace function public.mcp_link_game(p_token text, p_page uuid, p_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  ws uuid := public.mcp_check_page(uid, p_page, true);
begin
  if p_game is not null and not exists (select 1 from public.games where id = p_game and workspace_id = ws) then
    raise exception 'game not found in this workspace' using errcode = 'P0002';
  end if;
  update public.pages set game_id = p_game where id = p_page;
end;
$$;

create or replace function public.mcp_start_game_build(p_token text, p_game uuid, p_version text, p_notes text default null, p_entry text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  ws uuid;
  tname text;
  bid uuid;
begin
  select workspace_id into ws from public.games where id = p_game;
  if ws is null then raise exception 'game not found' using errcode = 'P0002'; end if;
  perform public.mcp_check_ws(uid, ws, true);
  select name into tname from public.api_tokens where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  insert into public.game_builds (game_id, workspace_id, version, notes, entry, uploaded_by, actor, actor_name)
  values (p_game, ws, left(trim(p_version), 60), p_notes, coalesce(nullif(trim(p_entry), ''), 'index.html'), uid, 'ai', tname)
  returning id into bid;
  return jsonb_build_object('build_id', bid, 'workspace_id', ws);
end;
$$;

create or replace function public.mcp_publish_game_build(p_token text, p_build uuid, p_entry text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  ws uuid;
begin
  select workspace_id into ws from public.game_builds where id = p_build;
  if ws is null then raise exception 'build not found' using errcode = 'P0002'; end if;
  perform public.mcp_check_ws(uid, ws, true);
  return public.game_build_publish_internal(p_build, p_entry);
end;
$$;

create or replace function public.mcp_list_game_builds(p_token text, p_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  ws uuid;
begin
  select workspace_id into ws from public.games where id = p_game;
  if ws is null then raise exception 'game not found' using errcode = 'P0002'; end if;
  perform public.mcp_check_ws(uid, ws, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'version', b.version, 'notes', b.notes, 'status', b.status, 'entry', b.entry,
      'files', jsonb_array_length(b.files), 'total_size', b.total_size, 'created_at', b.created_at,
      'by', case when b.actor = 'ai' then coalesce(b.actor_name, 'AI') else pr.display_name end,
      'latest', g.latest_build_id = b.id) order by b.created_at desc)
    from public.game_builds b
    join public.games g on g.id = b.game_id
    left join public.profiles pr on pr.id = b.uploaded_by
    where b.game_id = p_game), '[]'::jsonb);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'mcp_list_games(text, uuid)', 'mcp_create_game(text, uuid, text, text, uuid)', 'mcp_link_game(text, uuid, uuid)',
    'mcp_start_game_build(text, uuid, text, text, text)', 'mcp_publish_game_build(text, uuid, text)',
    'mcp_list_game_builds(text, uuid)']
  loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

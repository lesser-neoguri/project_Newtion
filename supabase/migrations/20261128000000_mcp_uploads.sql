-- =====================================================================
-- MCP file uploads (e.g. sprite GIFs for the sprite gallery block).
-- An AI tool asks for a ticket; for 2 hours, files may be uploaded to
--   uploads/<workspace_id>/t-<ticket_id>/<file>
-- with only the public key. The unguessable ticket id is the capability.
-- =====================================================================

create table public.mcp_upload_tickets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index mcp_upload_tickets_ws_idx on public.mcp_upload_tickets (workspace_id);
create index mcp_upload_tickets_user_idx on public.mcp_upload_tickets (user_id);
alter table public.mcp_upload_tickets enable row level security;
-- No policies: only the SECURITY DEFINER functions below touch it.

create or replace function public.mcp_ticket_open(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ws text := split_part(p_name, '/', 1);
  t  text := split_part(p_name, '/', 2);
begin
  if ws !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or t !~ '^t-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 3) = '' then
    return false;
  end if;
  return exists (select 1 from public.mcp_upload_tickets k
                 where k.id = substr(t, 3)::uuid and k.workspace_id = ws::uuid
                   and k.created_at > now() - interval '2 hours');
end;
$$;

create policy "uploads: mcp ticket upload" on storage.objects
  for insert to anon with check (bucket_id = 'uploads' and public.mcp_ticket_open(name));

create or replace function public.mcp_create_upload_ticket(p_token text, p_page uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.mcp_user(p_token);
  ws uuid := public.mcp_check_page(uid, p_page, true);
  tid uuid;
begin
  insert into public.mcp_upload_tickets (workspace_id, user_id) values (ws, uid) returning id into tid;
  delete from public.mcp_upload_tickets where created_at < now() - interval '1 day';
  return jsonb_build_object('ticket', tid, 'workspace_id', ws, 'prefix', ws::text || '/t-' || tid::text);
end;
$$;
revoke execute on function public.mcp_create_upload_ticket(text, uuid) from public;
grant execute on function public.mcp_create_upload_ticket(text, uuid) to anon, authenticated;

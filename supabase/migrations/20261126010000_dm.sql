-- =====================================================================
-- Direct messages between people who share a workspace, with image attachments.
--   dm_conversations  one row per pair (user_a < user_b)
--   dm_messages       text and/or images (private bucket "dm": <conversation_id>/<uuid>.<ext>)
--   dm_reads          how far each participant has read
-- =====================================================================

create table public.dm_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references auth.users (id) on delete cascade,
  user_b          uuid not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint dm_pair_order check (user_a < user_b),
  constraint dm_pair_unique unique (user_a, user_b)
);
create index dm_conversations_b_idx on public.dm_conversations (user_b);

create table public.dm_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  sender_id       uuid not null references auth.users (id) on delete cascade,
  body            text not null default '' check (length(body) <= 4000),
  attachments     jsonb not null default '[]'::jsonb,   -- [{path, name, type, size, width, height}]
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint dm_message_not_empty check (length(trim(body)) > 0 or jsonb_array_length(attachments) > 0 or deleted_at is not null)
);
create index dm_messages_conv_idx on public.dm_messages (conversation_id, created_at desc);
create index dm_messages_sender_idx on public.dm_messages (sender_id);

create table public.dm_reads (
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index dm_reads_user_idx on public.dm_reads (user_id);

-- Profiles join for the UI.
alter table public.dm_conversations
  add constraint dm_conversations_a_profile_fk foreign key (user_a) references public.profiles (id) on delete cascade,
  add constraint dm_conversations_b_profile_fk foreign key (user_b) references public.profiles (id) on delete cascade;

create or replace function public.dm_is_participant(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.dm_conversations c
                 where c.id = p_conv and (select auth.uid()) in (c.user_a, c.user_b));
$$;
revoke execute on function public.dm_is_participant(uuid) from public, anon;
grant execute on function public.dm_is_participant(uuid) to authenticated;

alter table public.dm_conversations enable row level security;
create policy "dm conv: participants read" on public.dm_conversations
  for select to authenticated using ((select auth.uid()) in (user_a, user_b));
-- Created only through dm_open().

alter table public.dm_messages enable row level security;
create policy "dm msg: participants read" on public.dm_messages
  for select to authenticated using (public.dm_is_participant(conversation_id));
create policy "dm msg: participants send" on public.dm_messages
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and deleted_at is null and public.dm_is_participant(conversation_id));
-- Senders can "unsend" (soft delete) their own messages.
create policy "dm msg: sender unsends" on public.dm_messages
  for update to authenticated using (sender_id = (select auth.uid())) with check (sender_id = (select auth.uid()));

alter table public.dm_reads enable row level security;
create policy "dm reads: participants read" on public.dm_reads
  for select to authenticated using (public.dm_is_participant(conversation_id));
create policy "dm reads: own insert" on public.dm_reads
  for insert to authenticated with check (user_id = (select auth.uid()) and public.dm_is_participant(conversation_id));
create policy "dm reads: own update" on public.dm_reads
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Keep conversation order fresh; an unsend can't change the body back.
create or replace function public.dm_after_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.dm_conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;
revoke execute on function public.dm_after_message() from public, anon, authenticated;
create trigger dm_messages_after_insert after insert on public.dm_messages
  for each row execute function public.dm_after_message();

create or replace function public.dm_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The only allowed change is unsending: clear the content and stamp deleted_at.
  if new.conversation_id <> old.conversation_id or new.sender_id <> old.sender_id or new.created_at <> old.created_at then
    raise exception 'not allowed';
  end if;
  if new.deleted_at is null then raise exception 'messages can only be unsent'; end if;
  new.body := '';
  new.attachments := '[]'::jsonb;
  return new;
end;
$$;
create trigger dm_messages_guard before update on public.dm_messages
  for each row execute function public.dm_guard_update();

-- Open (or create) the conversation with someone you share a workspace with.
create or replace function public.dm_open(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  a uuid := least(me, p_other);
  b uuid := greatest(me, p_other);
  cid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_other = me then raise exception 'cannot message yourself'; end if;
  select id into cid from public.dm_conversations where user_a = a and user_b = b;
  if cid is not null then return cid; end if;
  if not public.shares_workspace(p_other) then raise exception 'no permission' using errcode = '42501'; end if;
  insert into public.dm_conversations (user_a, user_b) values (a, b)
  on conflict (user_a, user_b) do update set user_a = excluded.user_a
  returning id into cid;
  return cid;
end;
$$;
revoke execute on function public.dm_open(uuid) from public, anon;
grant execute on function public.dm_open(uuid) to authenticated;

-- My conversations with the other person, last message and unread count.
create or replace function public.dm_inbox()
returns table (
  conversation_id uuid, other_id uuid, last_message_at timestamptz,
  last_body text, last_sender uuid, last_has_image boolean, unread bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end,
         c.last_message_at,
         lm.body, lm.sender_id, jsonb_array_length(coalesce(lm.attachments, '[]'::jsonb)) > 0,
         (select count(*) from public.dm_messages m
           where m.conversation_id = c.id and m.sender_id <> (select auth.uid()) and m.deleted_at is null
             and m.created_at > coalesce((select r.last_read_at from public.dm_reads r
                                           where r.conversation_id = c.id and r.user_id = (select auth.uid())), '-infinity'))
  from public.dm_conversations c
  left join lateral (select m.body, m.sender_id, m.attachments from public.dm_messages m
                     where m.conversation_id = c.id order by m.created_at desc limit 1) lm on true
  where (select auth.uid()) in (c.user_a, c.user_b)
  order by c.last_message_at desc;
$$;
revoke execute on function public.dm_inbox() from public, anon;
grant execute on function public.dm_inbox() to authenticated;

create or replace function public.dm_mark_read(p_conv uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.dm_reads (conversation_id, user_id, last_read_at)
  select p_conv, (select auth.uid()), now() where public.dm_is_participant(p_conv)
  on conflict (conversation_id, user_id) do update set last_read_at = now();
$$;
revoke execute on function public.dm_mark_read(uuid) from public, anon;
grant execute on function public.dm_mark_read(uuid) to authenticated;

alter publication supabase_realtime add table public.dm_messages;
alter publication supabase_realtime add table public.dm_reads;

-- ---------- attachments: private bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dm', 'dm', false, 20971520, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.dm_conv_of(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare s text := split_part(p_name, '/', 1);
begin
  if s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return s::uuid; end if;
  return null;
end;
$$;

create policy "dm files: participants upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'dm' and public.dm_is_participant(public.dm_conv_of(name)));
create policy "dm files: participants read" on storage.objects
  for select to authenticated using (bucket_id = 'dm' and public.dm_is_participant(public.dm_conv_of(name)));
create policy "dm files: uploader deletes" on storage.objects
  for delete to authenticated using (bucket_id = 'dm' and owner_id = (select auth.uid())::text);

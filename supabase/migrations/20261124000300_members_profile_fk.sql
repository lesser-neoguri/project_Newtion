-- Lets PostgREST embed profiles in workspace_members queries
-- (select user_id, role, profile:profiles(...)). Without it the members list
-- fails to load and every user is treated as a viewer.
alter table public.workspace_members
  add constraint workspace_members_user_profile_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

notify pgrst, 'reload schema';

-- Also fall back to the GitHub username (user_name) for new profiles.
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
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'user_name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    colors[1 + floor(random() * array_length(colors, 1))::int]
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

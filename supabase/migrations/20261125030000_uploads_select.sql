-- Storage needs a SELECT policy to delete or list objects through the API.
-- (Reading files still goes through the public URL; this only lets members see their workspace's objects.)
create policy "uploads: members read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'uploads'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

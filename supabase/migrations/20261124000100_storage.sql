-- File uploads for the editor (images, attachments).
-- Files live under "<workspace_id>/<random>.<ext>". The bucket is public-read so
-- links embedded in pages keep working; paths are unguessable UUIDs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', true, 20971520)
on conflict (id) do nothing;

create policy "uploads: members upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and public.can_edit(((storage.foldername(name))[1])::uuid)
  );

create policy "uploads: editors delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'uploads'
    and public.can_edit(((storage.foldername(name))[1])::uuid)
  );

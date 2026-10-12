-- Defence in depth for the private buckets: Supabase Storage itself refuses oversized files and
-- unexpected types, even though every upload already goes through a server action that checks both.
update storage.buckets set file_size_limit = 2 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id = 'kindergarten-assets';
update storage.buckets set file_size_limit = 5 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id = 'child-photos';
update storage.buckets set file_size_limit = 15 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  where id in ('announcements', 'chat-files', 'child-documents', 'staff-documents', 'receipts');

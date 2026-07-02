-- Ensure UPDATE policy exists for chat-attachments (Supabase storage may need it)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'Users can update own chat attachments'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Users can update own chat attachments"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = auth.uid()::text)
      WITH CHECK (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
    $policy$;
  END IF;
END $$;
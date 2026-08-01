-- Check if promo_codes table exists before applying policies
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'promo_codes'
  ) THEN
    DROP POLICY IF EXISTS "Anon can insert promo codes" ON public.promo_codes;
    CREATE POLICY "Anon can insert promo codes" ON public.promo_codes
      FOR INSERT
      TO anon
      WITH CHECK (true);
  END IF;
END $$;

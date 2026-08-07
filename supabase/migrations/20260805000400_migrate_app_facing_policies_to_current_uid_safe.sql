-- Rewrites every RLS policy on tables driver-app/rider-app actually query
-- (see grep of both apps' `.from(...)` calls) that references auth.uid(),
-- swapping it for public.current_uid_safe() — same logic, but returns
-- NULL instead of throwing when the JWT sub isn't UUID-shaped (Firebase).
--
-- Every policy on a table is evaluated together, so even the admin-only
-- policies here matter: if any one of them throws while evaluating
-- auth.uid(), the whole query fails for a Firebase-authenticated
-- request touching that table — regardless of whether that request was
-- ever trying to use the admin path. This is why the fix has to cover
-- all of them, not just the rider/driver-scoped "own row" policies.
--
-- Reconstructs each policy from pg_policies metadata (DROP + CREATE with
-- the same name/roles/command, only the expression text changed) inside
-- one DO block, so it's all-or-nothing — any single failure rolls back
-- the whole migration rather than leaving some policies swapped and
-- others not.
DO $$
DECLARE
  pol RECORD;
  new_qual TEXT;
  new_check TEXT;
  roles_sql TEXT;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE (qual ILIKE '%auth.uid()%' OR with_check ILIKE '%auth.uid()%')
      AND tablename IN (
        'demand_event_responses','demand_events','device_sessions','driver_achievement_unlocks',
        'driver_achievements','driver_locations','driver_loyalty_accounts','driver_missions',
        'driver_performance','driver_rewards','driver_safety_contacts','driver_settings',
        'driver_transactions','driver_wallet_transactions','driver_wallets','drivers',
        'emergency_alerts','marketing_banners','notifications','payments',
        'pricing_driver_incentives','pricing_surge_rules','referral_campaigns','ride_categories',
        'ride_messages','ride_requests','rider_settings','riders','rides','support_tickets',
        'transactions','trip_events','trip_queue','users','vehicle_class_eligibility',
        'vehicle_makes','vehicle_models','vehicles','wallets','weafrica_places'
      )
  LOOP
    new_qual := regexp_replace(pol.qual, 'auth\.uid\(\)', 'public.current_uid_safe()', 'g');
    new_check := regexp_replace(pol.with_check, 'auth\.uid\(\)', 'public.current_uid_safe()', 'g');
    roles_sql := array_to_string(pol.roles, ', ');

    EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
      pol.policyname, pol.schemaname, pol.tablename,
      pol.permissive,
      pol.cmd,
      roles_sql,
      CASE WHEN new_qual IS NOT NULL THEN format(' USING (%s)', new_qual) ELSE '' END,
      CASE WHEN new_check IS NOT NULL THEN format(' WITH CHECK (%s)', new_check) ELSE '' END
    );
  END LOOP;
END $$;

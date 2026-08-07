-- ============================================================
-- Driver auto-offline on inactivity (blueprint §16).
--
-- Uses driver_locations.updated_at as the activity signal — the
-- driver app pings this periodically while running/foregrounded, so it
-- naturally goes stale exactly when the app stops updating (backgrounded,
-- killed, or genuinely inactive). Never touches a driver with an active
-- ride (accepted/arrived/in_progress), per the blueprint's explicit
-- "never automatically take an active trip offline" requirement.
--
-- Two-stage, driven entirely by staleness thresholds (no extra
-- interactive round-trip needed): 10-20 min stale -> push "still
-- there?" prompt (self-clears next cycle if the driver's location
-- resumes, no explicit ack needed); >=20 min stale -> auto-offline +
-- notify.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS inactivity_prompt_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.auto_offline_inactive_drivers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_driver RECORD;
BEGIN
  -- Stage 2: auto-offline drivers stale >= 20 minutes
  FOR v_driver IN
    SELECT d.id, d.user_id, dl.updated_at
    FROM public.drivers d
    JOIN public.driver_locations dl ON dl.driver_id = d.id
    WHERE d.is_online = true
      AND dl.updated_at < now() - interval '20 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.rides r
        WHERE r.driver_id = d.id AND r.status IN ('accepted', 'arrived', 'in_progress')
      )
  LOOP
    UPDATE public.drivers
    SET is_online = false, online_status = 'offline', inactivity_prompt_sent_at = NULL
    WHERE id = v_driver.id;

    PERFORM public.notify_user_push(
      v_driver.user_id,
      'You were set offline',
      'You''ve been inactive for a while, so we set you offline. Go back online whenever you''re ready.',
      jsonb_build_object('reason', 'inactivity')
    );
  END LOOP;

  -- Stage 1: prompt drivers stale 10-20 minutes, if not already prompted
  -- for this staleness period (prompt is only re-sent once the driver's
  -- location has moved forward past the last prompt — i.e. they were
  -- active again in between).
  FOR v_driver IN
    SELECT d.id, d.user_id, dl.updated_at
    FROM public.drivers d
    JOIN public.driver_locations dl ON dl.driver_id = d.id
    WHERE d.is_online = true
      AND dl.updated_at < now() - interval '10 minutes'
      AND dl.updated_at >= now() - interval '20 minutes'
      AND (d.inactivity_prompt_sent_at IS NULL OR d.inactivity_prompt_sent_at < dl.updated_at)
      AND NOT EXISTS (
        SELECT 1 FROM public.rides r
        WHERE r.driver_id = d.id AND r.status IN ('accepted', 'arrived', 'in_progress')
      )
  LOOP
    UPDATE public.drivers SET inactivity_prompt_sent_at = now() WHERE id = v_driver.id;

    PERFORM public.notify_user_push(
      v_driver.user_id,
      'Still there?',
      'You''ll be set offline in 10 minutes if we don''t see activity.',
      jsonb_build_object('reason', 'inactivity_warning')
    );
  END LOOP;
END;
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'auto-offline-inactive-drivers';
SELECT cron.schedule('auto-offline-inactive-drivers', '*/5 * * * *', $$SELECT public.auto_offline_inactive_drivers();$$);

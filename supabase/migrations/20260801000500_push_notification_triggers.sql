-- ============================================================
-- Push notifications for trip-status changes and new ride requests.
--
-- Reuses existing (previously unused) infrastructure:
--   user_notification_tokens  — per-device FCM tokens, keyed by users.id
--   notification_delivery_logs — audit trail of individual sends
-- and pairs it with the new `send-push` edge function (thin FCM v1
-- sender, auth'd via a shared secret stored in Vault — never the
-- service_role key, so a leak of this secret only allows sending pushes,
-- not full DB access).
--
-- pg_net makes these calls async/non-blocking — a notification failure
-- (bad token, FCM outage, etc.) never blocks or fails the ride/trip
-- transaction that triggered it. notify_user_push() also wraps its body
-- in EXCEPTION WHEN OTHERS for the same reason.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_user_push(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token RECORD;
  v_log_id uuid;
  v_secret text;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'internal_push_secret' LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;

  FOR v_token IN
    SELECT fcm_token FROM public.user_notification_tokens
    WHERE user_id = p_user_id AND is_active = true
  LOOP
    INSERT INTO public.notification_delivery_logs (user_id, fcm_token, status)
    VALUES (p_user_id, v_token.fcm_token, 'pending')
    RETURNING id INTO v_log_id;

    PERFORM net.http_post(
      url := 'https://petoepgxeycfdkzvoexu.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
      body := jsonb_build_object(
        'delivery_log_id', v_log_id,
        'fcm_token', v_token.fcm_token,
        'title', p_title,
        'body', p_body,
        'data', p_data
      ),
      timeout_milliseconds := 8000
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- ============================================================
-- Rider/driver notifications on trip status transitions
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_notify_trip_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ride public.rides;
  v_rider_user_id uuid;
  v_driver_user_id uuid;
  v_driver_name text;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = NEW.trip_id;
  IF v_ride IS NULL THEN RETURN NEW; END IF;

  SELECT user_id INTO v_rider_user_id FROM public.riders WHERE id = v_ride.rider_id;
  SELECT user_id, full_name INTO v_driver_user_id, v_driver_name FROM public.drivers WHERE id = v_ride.driver_id;

  CASE NEW.new_state
    WHEN 'accepted' THEN
      PERFORM public.notify_user_push(v_rider_user_id, 'Driver assigned',
        COALESCE(v_driver_name, 'Your driver') || ' is on the way.',
        jsonb_build_object('trip_id', NEW.trip_id::text, 'status', NEW.new_state));
    WHEN 'arrived' THEN
      PERFORM public.notify_user_push(v_rider_user_id, 'Driver has arrived',
        'Your driver is waiting at the pickup point.',
        jsonb_build_object('trip_id', NEW.trip_id::text, 'status', NEW.new_state));
    WHEN 'in_progress' THEN
      PERFORM public.notify_user_push(v_rider_user_id, 'Trip started',
        'You''re on your way.',
        jsonb_build_object('trip_id', NEW.trip_id::text, 'status', NEW.new_state));
    WHEN 'driver_cancelled' THEN
      PERFORM public.notify_user_push(v_rider_user_id, 'Ride cancelled',
        'Your driver cancelled this ride. We''re finding you another one.',
        jsonb_build_object('trip_id', NEW.trip_id::text, 'status', NEW.new_state));
    WHEN 'rider_cancelled' THEN
      PERFORM public.notify_user_push(v_driver_user_id, 'Ride cancelled',
        'The rider cancelled this trip.',
        jsonb_build_object('trip_id', NEW.trip_id::text, 'status', NEW.new_state));
    WHEN 'system_cancelled' THEN
      PERFORM public.notify_user_push(v_rider_user_id, 'Ride cancelled',
        'This ride was cancelled.',
        jsonb_build_object('trip_id', NEW.trip_id::text, 'status', NEW.new_state));
    WHEN 'no_driver_found' THEN
      PERFORM public.notify_user_push(v_rider_user_id, 'No drivers available',
        'We could not find a driver nearby. Please try again.',
        jsonb_build_object('trip_id', NEW.trip_id::text, 'status', NEW.new_state));
    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_events_notify_push ON public.trip_events;
CREATE TRIGGER trip_events_notify_push
AFTER INSERT ON public.trip_events
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_trip_event();

-- ============================================================
-- Driver notification on a new ride request being dispatched to them
-- (INSERT only — re-offers via the ON CONFLICT DO UPDATE path in
-- dispatch_ride_to_nearby_drivers intentionally don't re-notify)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_notify_new_ride_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_driver_user_id uuid;
BEGIN
  SELECT user_id INTO v_driver_user_id FROM public.drivers WHERE id = NEW.driver_id;
  PERFORM public.notify_user_push(
    v_driver_user_id,
    'New ride request',
    COALESCE(NEW.pickup_address, 'Pickup nearby') || ' — tap to respond',
    jsonb_build_object('ride_id', NEW.ride_id::text, 'request_id', NEW.id::text)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ride_requests_notify_push ON public.ride_requests;
CREATE TRIGGER ride_requests_notify_push
AFTER INSERT ON public.ride_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_new_ride_request();

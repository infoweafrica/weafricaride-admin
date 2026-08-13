-- Cash payment push notifications — Module 8. Reuses notify_user_push()
-- (already defined in 20260801000500_push_notification_triggers.sql) and
-- follows the same pattern as trg_notify_trip_event(), just triggered off
-- rides.payment_status transitions instead of a trip_events insert, since
-- confirm_cash_payment() updates rides directly rather than going through
-- the trip_events/transition_trip_state path.

CREATE OR REPLACE FUNCTION public.trg_notify_cash_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rider_user_id uuid;
  v_driver_user_id uuid;
BEGIN
  SELECT user_id INTO v_rider_user_id FROM public.riders WHERE id = NEW.rider_id;
  SELECT user_id INTO v_driver_user_id FROM public.drivers WHERE id = NEW.driver_id;

  IF NEW.payment_status = 'paid' THEN
    PERFORM public.notify_user_push(v_rider_user_id, 'Cash payment confirmed',
      'MWK ' || COALESCE(NEW.cash_received, 0)::int || ' paid for your WeAfrica Ride' ||
        CASE WHEN COALESCE(NEW.rider_credit_amount, 0) > 0
          THEN '. MWK ' || NEW.rider_credit_amount::int || ' added to your ride credit.'
          ELSE '.' END,
      jsonb_build_object('ride_id', NEW.id::text, 'payment_status', NEW.payment_status));
    PERFORM public.notify_user_push(v_driver_user_id, 'Cash payment recorded',
      'MWK ' || COALESCE(NEW.cash_received, 0)::int || ' received.',
      jsonb_build_object('ride_id', NEW.id::text, 'payment_status', NEW.payment_status));
  ELSIF NEW.payment_status = 'partially_paid' THEN
    PERFORM public.notify_user_push(v_rider_user_id, 'Partial cash payment recorded',
      'MWK ' || COALESCE(NEW.cash_outstanding_amount, 0)::int || ' still owed to your driver.',
      jsonb_build_object('ride_id', NEW.id::text, 'payment_status', NEW.payment_status));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_notify_cash_payment ON public.rides;
CREATE TRIGGER rides_notify_cash_payment
AFTER UPDATE ON public.rides
FOR EACH ROW
WHEN (NEW.payment_method = 'cash' AND NEW.payment_status IS DISTINCT FROM OLD.payment_status)
EXECUTE FUNCTION public.trg_notify_cash_payment();

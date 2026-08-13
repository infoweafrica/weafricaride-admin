-- Cash Dispute Resolution — Module 6. Reuses ride_disputes (already has
-- dispute_type/ride_payment_method/refund_amount/penalty_amount/
-- resolution/resolved_by/assigned_admin_id/status — built for exactly
-- this) rather than a new cash_disputes table. Riders/drivers file a
-- dispute_type='payment' row the same way every other dispute already
-- gets filed (RiderReportIssueScreen's direct ride_disputes insert); this
-- adds the admin resolve action, which didn't exist for any dispute type
-- before this migration.
--
-- p_resolution_status is one of: 'confirmed_driver' (driver's version
-- accepted, no change), 'confirmed_rider' (rider's version accepted),
-- 'marked_paid' (admin overrides rides.payment_status to 'paid'),
-- 'marked_partial', 'reversed' (payment_status back to 'awaiting_cash').
-- Every path writes an audit_logs row — admin_id is NOT NULL on that
-- table, which is exactly right here since this is always an admin
-- action, never a system one.

CREATE OR REPLACE FUNCTION public.resolve_cash_dispute(
    p_dispute_id uuid,
    p_admin_id uuid,
    p_resolution_status text,
    p_resolution_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_dispute public.ride_disputes;
    v_old_payment_status text;
BEGIN
    IF p_resolution_status NOT IN ('confirmed_driver', 'confirmed_rider', 'marked_paid', 'marked_partial', 'reversed') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid resolution status', 'code', 'INVALID_RESOLUTION');
    END IF;

    SELECT * INTO v_dispute FROM public.ride_disputes WHERE id = p_dispute_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Dispute not found', 'code', 'DISPUTE_NOT_FOUND');
    END IF;
    IF v_dispute.status = 'resolved' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Dispute already resolved', 'code', 'ALREADY_RESOLVED');
    END IF;

    SELECT payment_status INTO v_old_payment_status FROM public.rides WHERE id = v_dispute.ride_id;

    UPDATE public.ride_disputes
    SET status = 'resolved',
        resolution = p_resolution_note,
        resolved_by = p_admin_id,
        resolved_at = now(),
        updated_at = now()
    WHERE id = p_dispute_id;

    IF v_dispute.dispute_type = 'payment' AND v_dispute.ride_id IS NOT NULL THEN
        IF p_resolution_status = 'marked_paid' THEN
            UPDATE public.rides
            SET payment_status = 'paid', cash_outstanding_amount = 0, updated_at = now()
            WHERE id = v_dispute.ride_id;
        ELSIF p_resolution_status = 'marked_partial' THEN
            UPDATE public.rides SET payment_status = 'partially_paid', updated_at = now()
            WHERE id = v_dispute.ride_id;
        ELSIF p_resolution_status = 'reversed' THEN
            UPDATE public.rides SET payment_status = 'awaiting_cash', updated_at = now()
            WHERE id = v_dispute.ride_id;
        END IF;
    END IF;

    INSERT INTO public.audit_logs (admin_id, action, target_type, target_id, target_name, details, metadata)
    VALUES (
        p_admin_id, 'resolve_cash_dispute', 'ride_dispute', p_dispute_id::text, v_dispute.dispute_number,
        p_resolution_note,
        jsonb_build_object(
            'ride_id', v_dispute.ride_id, 'resolution_status', p_resolution_status,
            'payment_status_before', v_old_payment_status
        )
    );

    RETURN jsonb_build_object('success', true, 'dispute_id', p_dispute_id, 'resolution_status', p_resolution_status);
END;
$$;

ALTER FUNCTION public.resolve_cash_dispute(uuid, uuid, text, text) OWNER TO postgres;
-- The admin dashboard's browser Supabase client authenticates via its own
-- custom email/password session (admin-auth.ts), not Supabase Auth — RPC
-- calls from it run as anon, so anon needs execute here too, same as the
-- other admin-callable RPCs already in this project.
GRANT EXECUTE ON FUNCTION public.resolve_cash_dispute(uuid, uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.resolve_cash_dispute(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_cash_dispute(uuid, uuid, text, text) TO service_role;

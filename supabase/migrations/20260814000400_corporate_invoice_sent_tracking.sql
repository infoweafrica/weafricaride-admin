-- Track whether a corporate invoice's PDF+email actually went out, and to
-- whom — needed now that generate_corporate_invoice's caller (the admin
-- API route) sends a real PDF email rather than nothing. Mirrors
-- ride_invoices.sent_email in spirit, but stores a timestamp (when) and
-- the destination address actually used, since a corporate invoice can be
-- resent and the finance_email on file can change between sends.

ALTER TABLE public.corporate_invoices
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to text;

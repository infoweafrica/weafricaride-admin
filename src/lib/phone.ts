// Malawi mobile number validation — mirrors public.normalize_mw_msisdn() in
// supabase/migrations/20260907160000_operator_booking_strict_validation.sql.
// The DB is the source of truth (it re-validates and cannot be bypassed);
// this is here so the operator dashboard can show the error inline before
// submitting.
//
// Valid: +265 followed by a 9-digit national number whose first digit is 8
// or 9. Accepts the shapes an operator realistically types.

export function normalizeMwPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let v = raw.replace(/[^0-9]/g, "");
  if (v === "") return null;

  if (v.startsWith("00")) v = v.slice(2);

  if (v.startsWith("265") && v.length === 12) {
    // already a full MSISDN
  } else if (v.startsWith("0") && v.length === 10) {
    v = "265" + v.slice(1);
  } else if (v.length === 9) {
    v = "265" + v;
  } else {
    return null;
  }

  return /^265[89][0-9]{8}$/.test(v) ? "+" + v : null;
}

export function isValidMwPhone(raw: string | null | undefined): boolean {
  return normalizeMwPhone(raw) !== null;
}

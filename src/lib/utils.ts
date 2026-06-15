export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatCurrency(value: number | string | null | undefined, currency = "MWK") {
  return new Intl.NumberFormat("en-MW", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function formatNumber(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-MW").format(Number(value || 0));
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-MW", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function timeAgo(value: string | Date | null | undefined) {
  if (!value) return "—";
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function getStatusColor(status?: string | null) {
  const s = String(status || "").toLowerCase();
  if (["active", "completed", "paid", "approved", "verified", "success", "online"].includes(s)) return "text-green-700 bg-green-50 border-green-200";
  if (["pending", "processing", "review", "in_progress", "requested"].includes(s)) return "text-yellow-700 bg-yellow-50 border-yellow-200";
  if (["cancelled", "failed", "rejected", "suspended", "blocked", "offline"].includes(s)) return "text-red-700 bg-red-50 border-red-200";
  return "text-gray-700 bg-gray-50 border-gray-200";
}

export function getRideStatusLabel(status?: string | null) {
  return String(status || "Unknown").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function getPaymentMethodLabel(method?: string | null) {
  return String(method || "Unknown").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function getApprovalStatusLabel(status?: string | null) {
  return String(status || "Unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

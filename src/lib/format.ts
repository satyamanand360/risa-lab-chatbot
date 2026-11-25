export const fmtInt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "–" : Math.round(n).toLocaleString("en-IN"));
export const fmtInr = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "–" : "₹" + Math.round(n).toLocaleString("en-IN"));
export const fmtInrK = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "–";
  if (Math.abs(n) >= 100000) return "₹" + (n / 100000).toFixed(2).replace(/\.?0+$/, "") + "L";
  if (Math.abs(n) >= 1000) return "₹" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return "₹" + Math.round(n);
};
export const fmtPct = (n: number | null | undefined, d = 0) => (n == null || !Number.isFinite(n) ? "–" : (n * 100).toFixed(d) + "%");
export const ratio = (a: number, b: number) => (b ? a / b : null);
export const fmtDate = (s: string | null | undefined) => {
  if (!s) return "–";
  const d = new Date(s.length === 10 ? s + "T00:00:00+05:30" : s);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
};
export const ACTION_LABEL: Record<string, string> = { scale: "Scale", hold: "Hold", fix: "Change", stop: "Stop" };

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) }, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`);
  return data as T;
}

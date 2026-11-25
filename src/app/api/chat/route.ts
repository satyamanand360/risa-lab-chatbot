import { handle } from "@/lib/http";
import { runAnalyst, chatTranscript } from "@/lib/agent";
import { InputError } from "@/lib/mutations";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Simple per-IP limit so a public demo link can't run up the API bill.
const hits = new Map<string, number[]>();
function allowed(ip: string) {
  const now = Date.now(), windowMs = 60 * 60 * 1000, max = Number(process.env.CHAT_LIMIT_PER_HOUR || 40);
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { hits.set(ip, list); return false; }
  list.push(now); hits.set(ip, list); return true;
}

export const GET = (req: Request) => handle(async () => {
  const s = new URL(req.url).searchParams.get("session");
  if (!s || !/^[A-Za-z0-9_-]{6,64}$/.test(s)) return [];
  return chatTranscript(s);
});

export const POST = (req: Request) => handle(async () => {
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  if (!allowed(ip)) throw new InputError("Hourly question limit reached for this demo. Please try again later.");
  const body = await req.json();
  const sessionId = String(body.sessionId || "");
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(sessionId)) throw new InputError("Invalid session");
  const message = String(body.message || "").trim();
  if (!message) throw new InputError("Message is empty");
  if (message.length > 4000) throw new InputError("Message is too long");
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(body.asOf) ? body.asOf : "2025-04-20";
  const notes: string[] = Array.isArray(body.notes) ? body.notes.filter((n: unknown) => typeof n === "string").slice(0, 10) : [];
  const text = (notes.length ? `[${notes.join(" ")}]\n` : "") + `[Selected as-of date: ${asOf}]\n${message}`;
  return runAnalyst(sessionId, text, asOf, message);
});

import { handle } from "@/lib/http";
import { resetDatabase } from "@/lib/db";
export const dynamic = "force-dynamic";
export const POST = () => handle(async () => { await resetDatabase(); return { ok: true }; });

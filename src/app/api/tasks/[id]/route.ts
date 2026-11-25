import { handle } from "@/lib/http";
import { updateTask, deleteTask } from "@/lib/mutations";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export const PATCH = async (req: Request, ctx: Ctx) => { const { id } = await ctx.params; return handle(async () => { await updateTask(Number(id), await req.json()); return { ok: true }; }); };
export const DELETE = async (_req: Request, ctx: Ctx) => { const { id } = await ctx.params; return handle(async () => { await deleteTask(Number(id)); return { ok: true }; }); };

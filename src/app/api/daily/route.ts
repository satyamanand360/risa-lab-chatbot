import { handle } from "@/lib/http";
import { addDaily, deleteDaily, InputError } from "@/lib/mutations";
export const dynamic = "force-dynamic";
export const POST = (req: Request) => handle(async () => ({ id: await addDaily(await req.json()) }));
export const DELETE = (req: Request) => handle(async () => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new InputError("id is required");
  await deleteDaily(id); return { ok: true };
});

import { handle } from "@/lib/http";
import { addCheckin } from "@/lib/mutations";
export const dynamic = "force-dynamic";
export const POST = (req: Request) => handle(async () => ({ id: await addCheckin(await req.json()) }));

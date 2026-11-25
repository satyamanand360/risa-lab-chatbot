import { handle } from "@/lib/http";
import { listTasks } from "@/lib/metrics";
import { createTask } from "@/lib/mutations";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => handle(async () => {
  const sp = new URL(req.url).searchParams;
  return listTasks({ status: sp.get("status") || undefined, campaign_id: sp.get("campaign_id") || undefined, owner: sp.get("owner") || undefined });
});
export const POST = (req: Request) => handle(async () => {
  const body = await req.json();
  return { id: await createTask(body, body.created_by === "ai" ? "ai" : "user") };
});

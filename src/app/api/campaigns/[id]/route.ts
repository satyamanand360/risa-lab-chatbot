import { handle, asOfParam, json } from "@/lib/http";
import { getMeta, campaignDetail } from "@/lib/metrics";
import { updateCampaign } from "@/lib/mutations";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export const GET = async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return handle(async () => {
    const meta = await getMeta();
    const d = await campaignDetail(id, asOfParam(req.url, meta.event.historyEnd));
    if (!d) return { error: "not found" };
    return d;
  });
};
export const PATCH = async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return handle(async () => { await updateCampaign(id, await req.json()); return { ok: true }; });
};

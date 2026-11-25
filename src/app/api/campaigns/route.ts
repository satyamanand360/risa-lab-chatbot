import { handle, asOfParam } from "@/lib/http";
import { getMeta, overview, recommend } from "@/lib/metrics";
import { createCampaign } from "@/lib/mutations";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => handle(async () => {
  const meta = await getMeta();
  const ov = await overview(asOfParam(req.url, meta.event.historyEnd));
  return { campaigns: ov.campaigns, recommendations: recommend(ov), phase: ov.phase };
});
export const POST = (req: Request) => handle(async () => ({ id: await createCampaign(await req.json()) }));

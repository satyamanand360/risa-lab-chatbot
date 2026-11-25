import { handle, asOfParam } from "@/lib/http";
import { getMeta, overview, recommend, bottlenecks, trend } from "@/lib/metrics";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => handle(async () => {
  const meta = await getMeta();
  const asOf = asOfParam(req.url, meta.event.historyEnd);
  const ov = await overview(asOf);
  return { ...ov, recommendations: recommend(ov), bottlenecks: bottlenecks(ov), trend: await trend(asOf) };
});

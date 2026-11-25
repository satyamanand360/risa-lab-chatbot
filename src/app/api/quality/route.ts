import { handle, asOfParam } from "@/lib/http";
import { getMeta, dataQuality } from "@/lib/metrics";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => handle(async () => { const m = await getMeta(); return dataQuality(asOfParam(req.url, m.event.historyEnd)); });

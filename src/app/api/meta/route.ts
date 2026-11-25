import { handle } from "@/lib/http";
import { getMeta } from "@/lib/metrics";
export const dynamic = "force-dynamic";
export const GET = () => handle(() => getMeta());

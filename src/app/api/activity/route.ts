import { handle } from "@/lib/http";
import { q } from "@/lib/db";
export const dynamic = "force-dynamic";
export const GET = () => handle(() => q(`SELECT id, at, actor, action, entity, entity_id, detail FROM activity_log ORDER BY id DESC LIMIT 50`));

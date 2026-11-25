import { handle } from "@/lib/http";
import { q } from "@/lib/db";
export const dynamic = "force-dynamic";
/** Search registrants by name or id, for status changes and manual check-ins. */
export const GET = (req: Request) => handle(async () => {
  const s = (new URL(req.url).searchParams.get("q") || "").trim();
  if (s.length < 2) return [];
  return q(`SELECT p.person_id, p.person_name, r.registration_id, r.campaign_id,
      (SELECT status FROM registration_history h WHERE h.registration_id = r.registration_id ORDER BY effective_at DESC, history_id DESC LIMIT 1) AS latest_status
    FROM people p LEFT JOIN registrations r ON r.person_id = p.person_id
    WHERE p.person_type='external' AND (p.person_name ILIKE $1 OR p.person_id ILIKE $1 OR r.registration_id ILIKE $1)
    ORDER BY p.person_name LIMIT 15`, [`%${s}%`]);
});

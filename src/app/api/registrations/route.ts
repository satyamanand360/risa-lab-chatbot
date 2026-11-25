import { handle } from "@/lib/http";
import { addRegistration, setRegistrationStatus } from "@/lib/mutations";
export const dynamic = "force-dynamic";
export const POST = (req: Request) => handle(async () => {
  const body = await req.json();
  if (body.registration_id) { await setRegistrationStatus(body); return { ok: true }; }
  return { id: await addRegistration(body) };
});

import { handle } from "@/lib/http";
import { setProposalStatus } from "@/lib/agent";
import { createTask, updateCampaign, InputError } from "@/lib/mutations";
import { q1 } from "@/lib/db";
export const dynamic = "force-dynamic";

/** The user confirms or dismisses a change the AI analyst proposed. Only this route writes it. */
export const POST = (req: Request) => handle(async () => {
  const { sessionId, proposal, action } = await req.json();
  if (!proposal?.id || !["confirm", "dismiss"].includes(action)) throw new InputError("Bad request");
  if (action === "dismiss") {
    await setProposalStatus(sessionId, proposal.id, "dismissed", "Dismissed by user");
    return { ok: true, note: `User dismissed proposal "${proposal.payload?.title ?? proposal.payload?.campaign_id}".` };
  }
  if (proposal.kind === "task") {
    const id = await createTask({ ...proposal.payload, status: "todo" }, "ai");
    const note = `User confirmed: task #${id} "${proposal.payload.title}" was created.`;
    await setProposalStatus(sessionId, proposal.id, "confirmed", note);
    return { ok: true, note, taskId: id };
  }
  if (proposal.kind === "campaign_change") {
    const before = await q1<any>(`SELECT name FROM campaigns WHERE id=$1`, [proposal.payload.campaign_id]);
    await updateCampaign(proposal.payload.campaign_id, proposal.payload.changes, "ai");
    const note = `User confirmed: campaign ${proposal.payload.campaign_id} (${before?.name}) updated with ${JSON.stringify(proposal.payload.changes)}.`;
    await setProposalStatus(sessionId, proposal.id, "confirmed", note);
    return { ok: true, note };
  }
  throw new InputError("Unknown proposal type");
});

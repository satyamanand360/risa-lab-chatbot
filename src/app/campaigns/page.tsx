"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/Shell";
import { ActionPill } from "@/components/Charts";
import { api, fmtInt, fmtInr, fmtInrK, fmtPct, ratio } from "@/lib/format";

export default function Campaigns() {
  const { asOf, version, bump, meta } = useApp();
  const [d, setD] = useState<any>(null);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<any>({ name: "", channel: "", owner_name: "", planned_budget_inr: "", attendee_target: "", audience: "", objective: "" });
  const [msg, setMsg] = useState("");
  useEffect(() => { api(`/api/campaigns?asOf=${asOf}`).then(setD); }, [asOf, version]);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try { const r = await api<any>("/api/campaigns", { method: "POST", body: JSON.stringify(form) }); setMsg(`Created ${r.id}.`); setShow(false); setForm({ name: "", channel: "", owner_name: "", planned_budget_inr: "", attendee_target: "", audience: "", objective: "" }); bump(); }
    catch (e: any) { setMsg(e.message); }
  }
  if (!d) return <div className="empty">Loading…</div>;
  const recs = Object.fromEntries(d.recommendations.map((r: any) => [r.campaign_id, r]));
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row between"><h1>Campaigns</h1><button className="btn primary" onClick={() => setShow(!show)}>{show ? "Cancel" : "New campaign"}</button></div>
      {msg && <div className={msg.startsWith("Created") ? "ok" : "err"}>{msg}</div>}
      {show && (
        <form className="card form" onSubmit={create}>
          <div className="field"><label>Name</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label>Channel</label><input placeholder="e.g. college_partners" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} /></div>
          <div className="field"><label>Owner</label><input list="owners" value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} /><datalist id="owners">{meta?.owners.map((o) => <option key={o} value={o} />)}</datalist></div>
          <div className="field"><label>Planned budget (₹)</label><input type="number" min={0} value={form.planned_budget_inr} onChange={(e) => setForm({ ...form, planned_budget_inr: e.target.value })} /></div>
          <div className="field"><label>Attendee target</label><input type="number" min={0} value={form.attendee_target} onChange={(e) => setForm({ ...form, attendee_target: e.target.value })} /></div>
          <div className="field"><label>Audience</label><input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} /></div>
          <div className="field"><label>Objective</label><input value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} /></div>
          <button className="btn primary">Create campaign</button>
        </form>
      )}
      <div className="grid g3">
        {d.campaigns.map((c: any) => {
          const r = recs[c.campaign_id];
          const used = ratio(c.spend, c.planned_budget_inr);
          return (
            <Link key={c.campaign_id} href={`/campaigns/${c.campaign_id}`} className="card" style={{ textDecoration: "none" }}>
              <div className="row between"><div><div className="small muted">{c.campaign_id} · {c.channel} · {c.owner_name}</div><h2>{c.name}</h2></div><ActionPill action={r?.action ?? "hold"} /></div>
              <div className="grid g3" style={{ marginTop: 12, gap: 8 }}>
                <div className="stat"><div className="label">Regs</div><div style={{ fontSize: 20, fontWeight: 700 }} className="num">{fmtInt(c.registrations)}</div></div>
                <div className="stat"><div className="label">Confirmed</div><div style={{ fontSize: 20, fontWeight: 700 }} className="num">{fmtInt(c.confirmed)}</div></div>
                <div className="stat"><div className="label">Attendees</div><div style={{ fontSize: 20, fontWeight: 700 }} className="num">{fmtInt(c.attendees)}</div></div>
              </div>
              <div className="small" style={{ marginTop: 10 }}>Spend {fmtInrK(c.spend)} of {fmtInrK(c.planned_budget_inr)} <span className="tag sim">{c.plan_source === "user" ? "edited" : "simulated"}</span> · {fmtInr(r?.value)} {r?.metric}</div>
              <div className="bar"><span style={{ width: `${Math.min(100, (used ?? 0) * 100)}%`, background: (used ?? 0) > 1 ? "var(--critical)" : undefined }} /></div>
              <div className="small muted" style={{ marginTop: 8 }}>{r?.reasons?.[0]}</div>
              <div className="small muted">{c.open_tasks} open tasks{c.overdue_tasks ? `, ${c.overdue_tasks} overdue` : ""} · {c.status}</div>
            </Link>
          );
        })}
      </div>
      <p className="small muted">Show rate and cancellation figures: {fmtPct(ratio(d.campaigns.reduce((a: number, c: any) => a + c.cancelled, 0), d.campaigns.reduce((a: number, c: any) => a + c.registrations, 0)), 1)} of registrations are cancelled as of this date.</p>
    </div>
  );
}

"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/Shell";
import { TrendChart, Funnel, ActionPill, DailyBars } from "@/components/Charts";
import { api, fmtInt, fmtInr, fmtInrK, fmtPct, fmtDate, ratio } from "@/lib/format";

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { asOf, version, bump, meta, openChat } = useApp();
  const [d, setD] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [daily, setDaily] = useState<any>({ activity_date: "", spend_inr: "", impressions: "", clicks: "", sessions: "", registration_starts: "" });
  const [task, setTask] = useState<any>({ title: "", owner_name: "", due_date: "", priority: "medium" });
  useEffect(() => { api(`/api/campaigns/${id}?asOf=${asOf}`).then((r) => { setD(r); setEdit({ status: r.campaign.status, planned_budget_inr: r.campaign.planned_budget_inr ?? "", attendee_target: r.campaign.attendee_target ?? "", owner_name: r.campaign.owner_name ?? "", notes: r.campaign.notes ?? "" }); }); }, [id, asOf, version]);
  useEffect(() => { setDaily((x: any) => ({ ...x, activity_date: asOf })); }, [asOf]);
  if (!d) return <div className="empty">Loading…</div>;
  if (d.error) return <div className="err">Campaign not found.</div>;
  const c = d.campaign, s = d.stats, rec = d.recommendation;
  const post = d.phase === "post";
  async function save() {
    setMsg("");
    try { await api(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ ...edit, planned_budget_inr: edit.planned_budget_inr === "" ? null : Number(edit.planned_budget_inr), attendee_target: edit.attendee_target === "" ? null : Number(edit.attendee_target) }) }); setMsg("Saved. Analytics updated."); bump(); }
    catch (e: any) { setMsg(e.message); }
  }
  async function addDaily(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try { await api("/api/daily", { method: "POST", body: JSON.stringify({ ...daily, campaign_id: id }) }); setMsg("Daily results logged. Analytics updated."); setDaily({ activity_date: asOf, spend_inr: "", impressions: "", clicks: "", sessions: "", registration_starts: "" }); bump(); }
    catch (e: any) { setMsg(e.message); }
  }
  async function delDaily(aid: string) { try { await api(`/api/daily?id=${encodeURIComponent(aid)}`, { method: "DELETE" }); bump(); } catch (e: any) { setMsg(e.message); } }
  async function addTask(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try { await api("/api/tasks", { method: "POST", body: JSON.stringify({ ...task, campaign_id: id }) }); setTask({ title: "", owner_name: "", due_date: "", priority: "medium" }); bump(); }
    catch (e: any) { setMsg(e.message); }
  }
  async function setTaskStatus(tid: number, status: string) { await api(`/api/tasks/${tid}`, { method: "PATCH", body: JSON.stringify({ status }) }); bump(); }
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="small"><Link href="/campaigns">← Campaigns</Link></div>
      <div className="row between">
        <div><div className="small muted">{c.id} · {c.channel} · owner {c.owner_name} · {c.status}</div><h1>{c.name}</h1><div className="small muted">{c.audience}</div></div>
        <div className="row"><ActionPill action={rec?.action ?? "hold"} /><button className="btn" onClick={() => openChat(`Diagnose ${c.name} (${c.id}) as of ${asOf}: what's working, what isn't, and what should we do next? Propose a task if one is warranted.`)}>Ask AI to diagnose</button></div>
      </div>
      {msg && <div className={msg.startsWith("Saved") || msg.startsWith("Daily") ? "ok" : "err"}>{msg}</div>}
      <div className="grid g4">
        <div className="card stat"><div className="label">Spend vs plan</div><div className="value">{fmtInrK(s.spend)}</div><div className="sub">of {fmtInrK(c.planned_budget_inr)} <span className="tag sim">{c.plan_source === "user" ? "edited" : "simulated"}</span></div><div className="bar"><span style={{ width: `${Math.min(100, (ratio(s.spend, c.planned_budget_inr) ?? 0) * 100)}%` }} /></div></div>
        <div className="card stat"><div className="label">Registrations</div><div className="value">{fmtInt(s.registrations)}</div><div className="sub">{fmtInt(s.confirmed)} confirmed · {fmtInt(s.cancelled)} cancelled · {fmtInt(s.waitlisted)} waitlisted</div></div>
        <div className="card stat"><div className="label">Verified attendees</div><div className="value">{fmtInt(s.attendees)}</div><div className="sub">target {fmtInt(c.attendee_target)} {post && `· show rate ${fmtPct(ratio(s.attendees, s.confirmed))}`}</div></div>
        <div className="card stat"><div className="label">{rec?.metric ?? "cost"}</div><div className="value">{fmtInr(rec?.value)}</div><div className="sub">blended {fmtInr(rec?.benchmark)} · ₹{fmtInt(ratio(s.spend, s.registrations))} per registration</div></div>
      </div>
      <div className="grid g2">
        <div className="card"><div className="card-h"><h2>Funnel</h2></div><Funnel stages={d.funnel} /></div>
        <div className="card">
          <div className="card-h"><h2>Why this call</h2><ActionPill action={rec?.action ?? "hold"} /></div>
          <ul className="list">{rec?.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
          <h3 style={{ margin: "14px 0 6px" }}>Engagement events (people-level)</h3>
          <table className="t"><tbody>{d.engagement.map((e: any) => <tr key={e.event_type}><td>{e.event_type.replace(/_/g, " ")}</td><td className="r">{fmtInt(e.n)}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="grid g2">
        <div className="card"><div className="card-h"><h2>Cumulative trend</h2></div><TrendChart data={d.trend} showPace={false} eventStart={meta?.event.startDate} /></div>
        <div className="card"><div className="card-h"><h2>Daily net spend</h2><span className="small muted">last 8 weeks</span></div><DailyBars data={d.trend} dataKey="dailySpend" name="Net spend" money /></div>
      </div>
      <div className="grid g2">
        <div className="card">
          <div className="card-h"><h2>Plan and status</h2></div>
          <div className="form">
            <div className="field"><label>Status</label><select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="active">active</option><option value="paused">paused</option><option value="stopped">stopped</option></select></div>
            <div className="field"><label>Planned budget (₹)</label><input type="number" min={0} value={edit.planned_budget_inr} onChange={(e) => setEdit({ ...edit, planned_budget_inr: e.target.value })} /></div>
            <div className="field"><label>Attendee target</label><input type="number" min={0} value={edit.attendee_target} onChange={(e) => setEdit({ ...edit, attendee_target: e.target.value })} /></div>
            <div className="field"><label>Owner</label><input list="owners2" value={edit.owner_name} onChange={(e) => setEdit({ ...edit, owner_name: e.target.value })} /><datalist id="owners2">{meta?.owners.map((o) => <option key={o} value={o} />)}</datalist></div>
          </div>
          <div className="field" style={{ marginTop: 10 }}><label>Notes</label><textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
          <div style={{ marginTop: 10 }}><button className="btn primary" onClick={save}>Save changes</button></div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Tasks</h2><Link className="small" href="/tasks">All tasks →</Link></div>
          {d.tasks.length === 0 ? <div className="small muted">No tasks yet.</div> :
            <table className="t"><tbody>{d.tasks.map((t: any) => (
              <tr key={t.id}><td><b>{t.title}</b> {t.created_by === "ai" && <span className="tag ai">from AI</span>}<div className="small muted">{t.owner_name} · due {fmtDate(t.due_date)}{t.status !== "done" && t.due_date && t.due_date < asOf ? <span className="err"> · overdue</span> : ""}</div></td>
                <td><select value={t.status} onChange={(e) => setTaskStatus(t.id, e.target.value)} aria-label="Task status"><option value="todo">to do</option><option value="in_progress">in progress</option><option value="done">done</option></select></td></tr>))}</tbody></table>}
          <form className="form" style={{ marginTop: 10 }} onSubmit={addTask}>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label>New task</label><input required value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} placeholder="What needs doing?" /></div>
            <div className="field"><label>Owner</label><input list="owners2" value={task.owner_name} onChange={(e) => setTask({ ...task, owner_name: e.target.value })} /></div>
            <div className="field"><label>Due</label><input type="date" value={task.due_date} onChange={(e) => setTask({ ...task, due_date: e.target.value })} /></div>
            <button className="btn">Add task</button>
          </form>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h2>Daily marketing results</h2><span className="small muted">Log a day's results; spend can be negative for a credit</span></div>
        <form className="form" onSubmit={addDaily}>
          <div className="field"><label>Date</label><input type="date" required value={daily.activity_date} onChange={(e) => setDaily({ ...daily, activity_date: e.target.value })} /></div>
          <div className="field"><label>Spend (₹)</label><input type="number" value={daily.spend_inr} onChange={(e) => setDaily({ ...daily, spend_inr: e.target.value })} /></div>
          <div className="field"><label>Impressions</label><input type="number" min={0} value={daily.impressions} onChange={(e) => setDaily({ ...daily, impressions: e.target.value })} /></div>
          <div className="field"><label>Clicks</label><input type="number" min={0} value={daily.clicks} onChange={(e) => setDaily({ ...daily, clicks: e.target.value })} /></div>
          <div className="field"><label>Landing sessions</label><input type="number" min={0} value={daily.sessions} onChange={(e) => setDaily({ ...daily, sessions: e.target.value })} /></div>
          <div className="field"><label>Registration starts</label><input type="number" min={0} value={daily.registration_starts} onChange={(e) => setDaily({ ...daily, registration_starts: e.target.value })} /></div>
          <button className="btn primary">Log results</button>
        </form>
        <div className="scroll-x" style={{ marginTop: 12, maxHeight: 320, overflowY: "auto" }}>
          <table className="t"><thead><tr><th>Date</th><th className="r">Spend</th><th className="r">Impr.</th><th className="r">Clicks</th><th className="r">Sessions</th><th className="r">Reg starts</th><th>Source</th><th /></tr></thead>
            <tbody>{d.daily.map((r: any) => <tr key={r.activity_id}><td>{fmtDate(r.activity_date)}</td><td className="r" style={{ color: r.spend_inr < 0 ? "var(--critical-ink)" : undefined }}>{fmtInr(r.spend_inr)}</td><td className="r">{fmtInt(r.impressions)}</td><td className="r">{fmtInt(r.clicks)}</td><td className="r">{fmtInt(r.sessions)}</td><td className="r">{fmtInt(r.registration_starts)}</td><td><span className={"tag" + (r.source === "user" ? " user" : "")}>{r.source === "user" ? "entered in app" : "dataset"}</span></td><td>{r.source === "user" && <button className="btn sm danger" onClick={() => delDaily(r.activity_id)}>Delete</button>}</td></tr>)}</tbody></table>
        </div>
      </div>
    </div>
  );
}

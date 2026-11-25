"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/components/Shell";
import { api, fmtDate } from "@/lib/format";

export default function DataEntry() {
  const { asOf, meta, bump, version } = useApp();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reg, setReg] = useState<any>({ person_name: "", campaign_id: "C04", date: asOf, status: "confirmed" });
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<any[]>([]);
  const [statusDate, setStatusDate] = useState(asOf);
  const [log, setLog] = useState<any[]>([]);
  useEffect(() => { setReg((r: any) => ({ ...r, date: asOf })); setStatusDate(asOf); }, [asOf]);
  useEffect(() => { api<any[]>("/api/activity").then(setLog); }, [version]);
  useEffect(() => { const t = setTimeout(() => { if (search.trim().length >= 2) api<any[]>(`/api/people?q=${encodeURIComponent(search)}`).then(setFound); else setFound([]); }, 250); return () => clearTimeout(t); }, [search, version]);
  const done = (text: string) => { setMsg({ ok: true, text }); bump(); };
  const fail = (e: any) => setMsg({ ok: false, text: e.message });
  async function addReg(e: React.FormEvent) { e.preventDefault(); try { const r = await api<any>("/api/registrations", { method: "POST", body: JSON.stringify(reg) }); done(`Registration ${r.id} recorded. Dashboards now include it from ${fmtDate(reg.date)}.`); setReg({ ...reg, person_name: "" }); } catch (e) { fail(e); } }
  async function setStatus(p: any, status: string) { try { await api("/api/registrations", { method: "POST", body: JSON.stringify({ registration_id: p.registration_id, status, date: statusDate }) }); done(`${p.person_name} marked ${status} from ${fmtDate(statusDate)}.`); } catch (e) { fail(e); } }
  async function checkIn(p: any) { try { await api("/api/checkins", { method: "POST", body: JSON.stringify({ person_id: p.person_id, date: statusDate }) }); done(`${p.person_name} checked in (verified) on ${fmtDate(statusDate)}.`); } catch (e) { fail(e); } }
  async function reset() {
    if (!confirm("Reset all data to the original dataset? Tasks, edits and logged results will be removed.")) return;
    try { await api("/api/reset", { method: "POST" }); done("Data reset to the original dataset."); } catch (e) { fail(e); }
  }
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div><h1>Log results</h1><div className="small muted">Record new registrations, status changes and check-ins. Every dashboard, recommendation and the AI analyst recalculate from these records. Daily spend and traffic are logged on each campaign page.</div></div>
      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}
      <div className="grid g2">
        <form className="card" onSubmit={addReg}>
          <div className="card-h"><h2>New registration</h2></div>
          <div className="form">
            <div className="field"><label>Name</label><input required value={reg.person_name} onChange={(e) => setReg({ ...reg, person_name: e.target.value })} /></div>
            <div className="field"><label>Campaign</label><select value={reg.campaign_id} onChange={(e) => setReg({ ...reg, campaign_id: e.target.value })}>{meta?.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="field"><label>Date</label><input type="date" required value={reg.date} onChange={(e) => setReg({ ...reg, date: e.target.value })} /></div>
            <div className="field"><label>Status</label><select value={reg.status} onChange={(e) => setReg({ ...reg, status: e.target.value })}><option>confirmed</option><option>interested</option><option>waitlisted</option></select></div>
          </div>
          <div style={{ marginTop: 10 }}><button className="btn primary">Record registration</button></div>
        </form>
        <div className="card">
          <div className="card-h"><h2>Update a registrant</h2></div>
          <div className="form">
            <div className="field" style={{ gridColumn: "span 2" }}><label>Search name or ID</label><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Leena or R0001" /></div>
            <div className="field"><label>Effective date</label><input type="date" value={statusDate} onChange={(e) => setStatusDate(e.target.value)} /></div>
          </div>
          <table className="t" style={{ marginTop: 8 }}><tbody>{found.map((p) => (
            <tr key={p.person_id + (p.registration_id ?? "")}><td><b>{p.person_name}</b><div className="small muted">{p.person_id} · {p.registration_id ?? "no registration"} · {p.campaign_id ?? "–"} · latest {p.latest_status ?? "–"}</div></td>
              <td><div className="row">{p.registration_id && <><button className="btn sm" onClick={() => setStatus(p, "confirmed")}>Confirm</button><button className="btn sm" onClick={() => setStatus(p, "cancelled")}>Cancel</button></>}<button className="btn sm" onClick={() => checkIn(p)}>Check in</button></div></td></tr>))}</tbody></table>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h2>Recent changes</h2><button className="btn sm danger" onClick={reset}>Reset demo data</button></div>
        {log.length === 0 ? <div className="small muted">No changes yet.</div> :
          <table className="t"><thead><tr><th>When</th><th>Who</th><th>Change</th><th>Detail</th></tr></thead><tbody>{log.map((l) => <tr key={l.id}><td className="small">{new Date(l.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td>{l.actor === "ai" ? <span className="tag ai">AI, confirmed by user</span> : "user"}</td><td>{l.action} {l.entity.replace(/_/g, " ")} {l.entity_id}</td><td className="small muted">{JSON.stringify(l.detail)}</td></tr>)}</tbody></table>}
      </div>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/components/Shell";
import { api, fmtDate } from "@/lib/format";

const COLS = [{ k: "todo", label: "To do" }, { k: "in_progress", label: "In progress" }, { k: "done", label: "Done" }];
const blank = { title: "", description: "", campaign_id: "", owner_name: "", due_date: "", priority: "medium" };

export default function Tasks() {
  const { asOf, version, bump, meta, openChat } = useApp();
  const [tasks, setTasks] = useState<any[]>([]);
  const [form, setForm] = useState<any>(blank);
  const [editing, setEditing] = useState<any>(null);
  const [owner, setOwner] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { api<any[]>("/api/tasks").then(setTasks); }, [version]);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try { await api("/api/tasks", { method: "POST", body: JSON.stringify(form) }); setForm(blank); bump(); } catch (e: any) { setErr(e.message); }
  }
  async function patch(id: number, body: any) { setErr(""); try { await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }); bump(); } catch (e: any) { setErr(e.message); } }
  async function remove(id: number) { await api(`/api/tasks/${id}`, { method: "DELETE" }); bump(); }
  const shown = tasks.filter((t) => !owner || t.owner_name === owner);
  const overdue = shown.filter((t) => t.status !== "done" && t.due_date && t.due_date < asOf).length;
  const owners = Array.from(new Set([...(meta?.owners ?? []), ...tasks.map((t) => t.owner_name).filter(Boolean)]));
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row between">
        <div><h1>Tasks</h1><div className="small muted">{shown.filter((t) => t.status !== "done").length} open · {overdue} overdue as of {fmtDate(asOf)}</div></div>
        <div className="row">
          <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Filter by owner" className="chip"><option value="">All owners</option>{owners.map((o) => <option key={o}>{o}</option>)}</select>
          <button className="btn" onClick={() => openChat("Look at the open tasks against current campaign performance. Which tasks matter most, what's missing, and is anything overdue? Propose up to 3 new tasks if needed.")}>Ask AI to review tasks</button>
        </div>
      </div>
      <form className="card form" onSubmit={create}>
        <div className="field" style={{ gridColumn: "span 2" }}><label>Task</label><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Pitch group passes to 20 more college clubs" /></div>
        <div className="field"><label>Campaign</label><select value={form.campaign_id} onChange={(e) => setForm({ ...form, campaign_id: e.target.value })}><option value="">None</option>{meta?.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>Owner</label><input list="owners3" value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} /><datalist id="owners3">{owners.map((o) => <option key={o} value={o} />)}</datalist></div>
        <div className="field"><label>Due</label><input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
        <div className="field"><label>Priority</label><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>low</option><option>medium</option><option>high</option></select></div>
        <button className="btn primary">Add task</button>
      </form>
      {err && <div className="err">{err}</div>}
      <div className="kanban">
        {COLS.map((col) => (
          <div className="kcol" key={col.k}>
            <h3 style={{ margin: "2px 4px 10px" }}>{col.label} <span className="muted">({shown.filter((t) => t.status === col.k).length})</span></h3>
            {shown.filter((t) => t.status === col.k).map((t) => {
              const late = t.status !== "done" && t.due_date && t.due_date < asOf;
              if (editing?.id === t.id) return (
                <div className="kcard" key={t.id}>
                  <div className="field"><label>Title</label><input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></div>
                  <div className="field"><label>Owner</label><input value={editing.owner_name ?? ""} onChange={(e) => setEditing({ ...editing, owner_name: e.target.value })} /></div>
                  <div className="field"><label>Due</label><input type="date" value={editing.due_date ?? ""} onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} /></div>
                  <div className="field"><label>Priority</label><select value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value })}><option>low</option><option>medium</option><option>high</option></select></div>
                  <div className="row" style={{ marginTop: 8 }}><button className="btn primary sm" onClick={async () => { await patch(t.id, { title: editing.title, owner_name: editing.owner_name, due_date: editing.due_date || null, priority: editing.priority }); setEditing(null); }}>Save</button><button className="btn sm" onClick={() => setEditing(null)}>Cancel</button></div>
                </div>
              );
              return (
                <div className={"kcard" + (late ? " overdue" : "")} key={t.id}>
                  <div className="row between"><b>{t.title}</b></div>
                  <div className="small muted" style={{ margin: "4px 0" }}>{[t.campaign_name, t.owner_name, t.due_date && `due ${fmtDate(t.due_date)}`, `${t.priority} priority`].filter(Boolean).join(" · ")}</div>
                  {late && <div className="small err">Overdue</div>}
                  {t.created_by === "ai" && <span className="tag ai">created from AI suggestion</span>}
                  {t.rationale && <div className="small muted" style={{ marginTop: 4 }}>Why: {t.rationale}</div>}
                  <div className="row" style={{ marginTop: 8 }}>
                    {COLS.filter((c) => c.k !== t.status).map((c) => <button key={c.k} className="btn sm" onClick={() => patch(t.id, { status: c.k })}>→ {c.label}</button>)}
                    <button className="btn sm" onClick={() => setEditing({ ...t })}>Edit</button>
                    <button className="btn sm danger" onClick={() => remove(t.id)}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

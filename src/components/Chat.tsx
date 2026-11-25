"use client";
import { useEffect, useRef, useState } from "react";
import { api, fmtDate } from "@/lib/format";

type Proposal = { id: string; kind: "task" | "campaign_change"; status: "pending" | "confirmed" | "dismissed"; payload: any; result?: string };
type Turn = { user: string; text?: string; toolsUsed?: { name: string; summary: string }[]; proposals?: Proposal[]; asOf?: string; pending?: boolean; error?: boolean };

const SUGGESTIONS = [
  "Are we on track for the attendee goal? What's the gap and why?",
  "Which campaigns should we scale, change or stop? Show the numbers.",
  "Why did registrations change in the last two weeks?",
  "Where is the biggest bottleneck in the funnel?",
  "Which colleges are sending the most attendees?",
];

function newId() { return "s" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); }

/** Minimal, safe markdown: escapes HTML, then renders bold, inline code, lists, simple tables and paragraphs. */
function renderMarkdown(src: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = src.split("\n");
  let html = ""; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      html += "<table>" + rows.map((r, ri) => "<tr>" + r.map((c) => (ri === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("") + "</tr>").join("") + "</table>";
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      let items = "";
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items += `<li>${inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`; i++; }
      html += ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
      continue;
    }
    if (/^#{1,4}\s/.test(l)) { html += `<p><b>${inline(l.replace(/^#+\s/, ""))}</b></p>`; i++; continue; }
    if (!l.trim()) { i++; continue; }
    let para = l; i++;
    while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^\s*\|/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])) { para += " " + lines[i]; i++; }
    html += `<p>${inline(para)}</p>`;
  }
  return html;
}

export default function Chat({ asOf, onClose, pendingPrompt, clearPending, onDataChanged }: { asOf: string; onClose: () => void; pendingPrompt?: string; clearPending: () => void; onDataChanged: () => void }) {
  const [sessionId, setSessionId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const notesRef = useRef<string[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let s = "";
    try { s = localStorage.getItem("chatSession") || ""; } catch {}
    if (!s) { s = newId(); try { localStorage.setItem("chatSession", s); } catch {} }
    setSessionId(s);
    api<Turn[]>(`/api/chat?session=${s}`).then((t) => setTurns(t || [])).catch(() => {});
  }, []);
  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" }); }, [turns]);
  useEffect(() => { if (pendingPrompt && sessionId && !busy) { send(pendingPrompt); clearPending(); } }, [pendingPrompt, sessionId]); // eslint-disable-line

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy || !sessionId) return;
    setBusy(true); setInput("");
    setTurns((t) => [...t, { user: msg, pending: true, asOf }]);
    try {
      const notes = notesRef.current; notesRef.current = [];
      const r = await api<any>("/api/chat", { method: "POST", body: JSON.stringify({ sessionId, message: msg, asOf, notes }) });
      setTurns((t) => [...t.slice(0, -1), { user: msg, text: r.text, toolsUsed: r.toolsUsed, proposals: r.proposals, asOf, error: !!r.error }]);
    } catch (e: any) {
      setTurns((t) => [...t.slice(0, -1), { user: msg, text: e.message || "Request failed.", error: true, asOf }]);
    } finally { setBusy(false); }
  }

  async function decide(ti: number, p: Proposal, action: "confirm" | "dismiss") {
    try {
      const r = await api<any>("/api/chat/proposal", { method: "POST", body: JSON.stringify({ sessionId, proposal: p, action }) });
      notesRef.current.push(r.note);
      setTurns((t) => t.map((turn, i) => i !== ti ? turn : { ...turn, proposals: turn.proposals?.map((x) => x.id === p.id ? { ...x, status: action === "confirm" ? "confirmed" : "dismissed", result: r.note } : x) }));
      if (action === "confirm") onDataChanged();
    } catch (e: any) { alertInline(ti, p.id, e.message); }
  }
  function alertInline(ti: number, pid: string, message: string) {
    setTurns((t) => t.map((turn, i) => i !== ti ? turn : { ...turn, proposals: turn.proposals?.map((x) => x.id === pid ? { ...x, result: "Error: " + message } : x) }));
  }
  function reset() {
    const s = newId(); try { localStorage.setItem("chatSession", s); } catch {}
    setSessionId(s); setTurns([]); notesRef.current = [];
  }

  return (
    <aside className="chat" aria-label="AI growth analyst">
      <div className="chat-h">
        <div><h2>AI growth analyst</h2><div className="small muted">Answers from this app's data as of {fmtDate(asOf)}</div></div>
        <div className="row"><button className="btn sm" onClick={reset} title="Start a new conversation">New chat</button><button className="btn sm" onClick={onClose} aria-label="Close chat">✕</button></div>
      </div>
      <div className="chat-body" ref={bodyRef}>
        {turns.length === 0 && (
          <div className="small muted">
            <p style={{ marginTop: 0 }}>Ask about performance, bottlenecks or what to do next. I query the live data with tools, show my working, and say when the data can't answer. I can draft tasks or campaign changes, but nothing is saved until you confirm.</p>
            <div className="suggest">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="msg user">{t.user}</div>
            {t.pending ? <div className="msg assistant muted">Analysing the data…</div> : (
              <div className="msg assistant">
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(t.text || "") }} />
                {!!t.toolsUsed?.length && <div className="tools-used">Data checked: {t.toolsUsed.map((u) => u.name.replace(/_/g, " ") + (u.summary ? ` (${u.summary})` : "")).join(" · ")}</div>}
              </div>
            )}
            {t.proposals?.map((p) => (
              <div className="proposal" key={p.id}>
                <div className="small muted" style={{ fontWeight: 600 }}>{p.kind === "task" ? "Proposed task" : "Proposed campaign change"} · {p.status === "pending" ? "needs your confirmation" : p.status}</div>
                {p.kind === "task" ? (
                  <div style={{ margin: "4px 0" }}>
                    <b>{p.payload.title}</b>
                    <div className="small">{[p.payload.campaign_id, p.payload.owner_name, p.payload.due_date && `due ${fmtDate(p.payload.due_date)}`, p.payload.priority && `${p.payload.priority} priority`].filter(Boolean).join(" · ")}</div>
                    {p.payload.description && <div className="small">{p.payload.description}</div>}
                  </div>
                ) : (
                  <div style={{ margin: "4px 0" }}><b>{p.payload.campaign_id}</b>: {Object.entries(p.payload.changes).map(([k, v]) => `${k.replace(/_/g, " ")} → ${v}`).join(", ")}</div>
                )}
                {p.payload.rationale && <div className="small muted">Why: {p.payload.rationale}</div>}
                {p.status === "pending" ? (
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn primary sm" onClick={() => decide(i, p, "confirm")}>{p.kind === "task" ? "Create task" : "Apply change"}</button>
                    <button className="btn sm" onClick={() => decide(i, p, "dismiss")}>Dismiss</button>
                  </div>
                ) : p.result && <div className={"small " + (p.result.startsWith("Error") ? "err" : "ok")} style={{ marginTop: 6 }}>{p.result}</div>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <form className="chat-f" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question or a follow-up…" rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} aria-label="Message the AI analyst" />
        <div className="row between"><span className="small muted">Enter to send · Shift+Enter for a new line</span><button className="btn primary sm" disabled={busy || !input.trim()}>{busy ? "Working…" : "Send"}</button></div>
      </form>
    </aside>
  );
}

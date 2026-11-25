"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, fmtDate } from "@/lib/format";
import Chat from "./Chat";

type Meta = { event: { name: string; historyStart: string; historyEnd: string; startDate: string; endDate: string }; latestDataDate: string; campaigns: { id: string; name: string; channel: string; owner_name: string; status: string }[]; owners: string[] };
type Ctx = { asOf: string; setAsOf: (d: string) => void; meta: Meta | null; version: number; bump: () => void; openChat: (prompt?: string) => void };
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/tasks", label: "Tasks" },
  { href: "/data-entry", label: "Log results" },
  { href: "/plan", label: "Plan 2026 (Bengaluru)" },
  { href: "/data", label: "Data & definitions" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [asOf, setAsOfState] = useState<string>("");
  const [version, setVersion] = useState(0);
  const [chatOpen, setChatOpen] = useState(true);
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>();

  useEffect(() => {
    api<Meta>("/api/meta").then((m) => {
      setMeta(m);
      let saved = "";
      try { saved = localStorage.getItem("asOf") || ""; } catch {}
      setAsOfState(saved && saved >= m.event.historyStart && saved <= m.event.historyEnd ? saved : "2025-03-20");
    }).catch(() => {});
    try { if (localStorage.getItem("chatOpen") === "0") setChatOpen(false); } catch {}
  }, [version]);

  const setAsOf = useCallback((d: string) => { setAsOfState(d); try { localStorage.setItem("asOf", d); } catch {} }, []);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const openChat = useCallback((p?: string) => { setChatOpen(true); setPendingPrompt(p); try { localStorage.setItem("chatOpen", "1"); } catch {} }, []);
  const ctx = useMemo(() => ({ asOf, setAsOf, meta, version, bump, openChat }), [asOf, setAsOf, meta, version, bump, openChat]);

  const presets = meta ? [
    { d: "2025-02-15", label: "Mid Feb" },
    { d: "2025-03-14", label: "Before target change" },
    { d: "2025-03-20", label: "20 Mar" },
    { d: "2025-04-11", label: "Event eve" },
    { d: meta.event.historyEnd, label: "After event" },
  ] : [];

  return (
    <AppCtx.Provider value={ctx}>
      <div className={"app" + (chatOpen ? " with-chat" : "")}>
        <nav className="side">
          <div className="logo">Growth Center</div>
          <div className="sub">{meta?.event.name ?? "…"} · attendee growth</div>
          {NAV.map((n) => <Link key={n.href} href={n.href} className={(n.href === "/" ? path === "/" : path.startsWith(n.href)) ? "on" : ""}>{n.label}</Link>)}
          <div className="spacer" />
          <div className="foot">RISA Labs Growth APM assignment. Source data is synthetic. Items tagged <b>simulated</b> are assumptions, not source data.</div>
        </nav>
        <main className="main">
          <div className="topbar">
            <div className="datebox" title="Every number is computed as it stood at the end of this day (IST). Later records are ignored.">
              <span className="small muted">Data as of</span>
              <input type="date" value={asOf} min={meta?.event.historyStart} max={meta?.event.historyEnd} onChange={(e) => e.target.value && setAsOf(e.target.value)} aria-label="Data as of date" />
            </div>
            <div className="row">{presets.map((p) => <button key={p.d} className={"chip" + (asOf === p.d ? " on" : "")} onClick={() => setAsOf(p.d)}>{p.label}</button>)}</div>
            <div className="grow" />
            {meta && <span className="small muted">Event {fmtDate(meta.event.startDate)}–{fmtDate(meta.event.endDate)}</span>}
            {!chatOpen && <button className="btn primary" onClick={() => openChat()}>Ask the AI analyst</button>}
          </div>
          {asOf ? children : <div className="empty">Loading data…</div>}
        </main>
        {chatOpen && asOf && <Chat asOf={asOf} onClose={() => { setChatOpen(false); try { localStorage.setItem("chatOpen", "0"); } catch {} }} pendingPrompt={pendingPrompt} clearPending={() => setPendingPrompt(undefined)} onDataChanged={bump} />}
      </div>
    </AppCtx.Provider>
  );
}

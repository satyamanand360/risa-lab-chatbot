"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/Shell";
import { TrendChart, Funnel, ActionPill } from "@/components/Charts";
import { api, fmtInt, fmtInr, fmtInrK, fmtPct, fmtDate, ratio } from "@/lib/format";

export default function Overview() {
  const { asOf, version, openChat } = useApp();
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { setErr(""); api(`/api/overview?asOf=${asOf}`).then(setD).catch((e) => setErr(e.message)); }, [asOf, version]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <div className="empty">Loading…</div>;
  const t = d.totals, tg = d.target;
  const camp = d.campaigns as any[];
  const totalFunnel = {
    impressions: t.impressions, clicks: t.clicks, sessions: t.sessions, registration_starts: t.registration_starts,
    people: t.people, registrations: t.registrations, confirmed: t.confirmed, attendees: t.attendees,
  };
  const stages = [
    { key: "impressions", label: "Impressions", value: t.impressions, kind: "platform count", rateFromPrev: null },
    { key: "clicks", label: "Clicks", value: t.clicks, kind: "platform count", rateFromPrev: ratio(t.clicks, t.impressions) },
    { key: "sessions", label: "Landing sessions", value: t.sessions, kind: "platform count", rateFromPrev: ratio(t.sessions, t.clicks) },
    { key: "registration_starts", label: "Registration starts", value: t.registration_starts, kind: "platform count", rateFromPrev: ratio(t.registration_starts, t.sessions) },
    { key: "people", label: "Identified people", value: t.people, kind: "people", rateFromPrev: null },
    { key: "registrations", label: "Registrations", value: t.registrations, kind: "people", rateFromPrev: ratio(t.registrations, t.people) },
    { key: "confirmed", label: "Confirmed (latest status)", value: t.confirmed, kind: "people", rateFromPrev: ratio(t.confirmed, t.registrations) },
    { key: "attendees", label: `Verified attendees${t.walk_ins ? ` (incl. ${t.walk_ins} walk-ins)` : ""}`, value: t.attendees, kind: "people", rateFromPrev: d.phase === "pre" ? null : ratio(t.registered_attendees, t.confirmed) },
  ];
  void totalFunnel;
  const recs = Object.fromEntries((d.recommendations as any[]).map((r) => [r.campaign_id, r]));
  const drivers = camp.map((c) => ({ ...c, delta: c.regs_last7 - c.regs_prev7 })).filter((c) => c.regs_last7 + c.regs_prev7 > 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const totalLast7 = camp.reduce((a, c) => a + c.regs_last7, 0), totalPrev7 = camp.reduce((a, c) => a + c.regs_prev7, 0);
  const tile = (label: string, value: string, sub: string, progress?: number | null, tone?: string) => (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="sub">{sub}</div>
      {progress != null && <div className="bar"><span style={{ width: `${Math.min(100, progress * 100)}%`, background: tone }} /></div>}
    </div>
  );
  const proj = d.projection;
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row between">
        <div>
          <h1>Attendee growth overview</h1>
          <div className="muted small">As of end of {fmtDate(asOf)} IST · {d.phase === "pre" ? `${d.daysToEvent} days to the event` : d.phase === "during" ? "event in progress" : "event finished"} · Goals from “{tg?.version}” (in force since {fmtDate(tg?.effectiveAt)})</div>
        </div>
        <button className="btn" onClick={() => openChat("Give me a 5-line status brief for today: are we on track for the attendee goal, what is driving the change, and what should we do this week?")}>Ask for a status brief</button>
      </div>

      <div className="grid g4">
        {tile("Verified attendees", fmtInt(t.attendees), d.phase === "pre" ? `Goal ${fmtInt(tg?.attendees)} · check-ins start on event day` : `${fmtPct(ratio(t.attendees, tg?.attendees))} of goal ${fmtInt(tg?.attendees)}`, ratio(t.attendees, tg?.attendees), "var(--s2)")}
        {tile("Registrations", fmtInt(t.registrations), `${fmtPct(ratio(t.registrations, tg?.registrations))} of goal ${fmtInt(tg?.registrations)} · ${fmtInt(t.confirmed)} confirmed`, ratio(t.registrations, tg?.registrations))}
        {tile("Identified people", fmtInt(t.people), `${fmtPct(ratio(t.people, tg?.people))} of goal ${fmtInt(tg?.people)} · external only`, ratio(t.people, tg?.people))}
        {tile("Marketing spend (net)", fmtInrK(t.spend), `${fmtPct(t.budget_used)} of ${fmtInrK(tg?.budget)} budget · ${fmtInr(t.cost_per_attendee ?? t.cost_per_confirmed)} per ${t.attendees ? "attendee" : "confirmed reg"}`, t.budget_used, t.budget_used > 1 ? "var(--critical)" : undefined)}
      </div>

      <div className="grid g21">
        <div className="card">
          <div className="card-h"><h2>Registrations and attendance over time</h2><span className="small muted">Pace line follows the goal in force on each date</span></div>
          <TrendChart data={d.trend} eventStart={d.event.startDate} />
        </div>
        <div className="card">
          <div className="card-h"><h2>Projected outcome</h2><span className="tag">{proj.method === "actual" ? "actual" : "projection"}</span></div>
          <div className="stat"><div className="value">{fmtInt(proj.attendees)}</div><div className="sub">verified attendees {proj.method === "actual" ? "(final)" : "projected at event"} vs goal {fmtInt(tg?.attendees)}</div></div>
          <div style={{ margin: "10px 0" }}>
            <span className={"pill " + (proj.vsTarget >= 0 ? "act-scale" : proj.vsTarget > -0.1 * tg.attendees ? "act-fix" : "act-stop")}><span className="dot" />{proj.vsTarget >= 0 ? `On track, +${fmtInt(proj.vsTarget)}` : `Gap of ${fmtInt(-proj.vsTarget)}`}</span>
          </div>
          {proj.method !== "actual" && <ul className="list small">
            <li>Registrations: {fmtInt(t.registrations)} now, {proj.regsPerDayLast14}/day over the last 14 days → {fmtInt(proj.registrations)} by event day</li>
            <li>Confirmed share {fmtPct(ratio(t.confirmed, t.registrations))} → {fmtInt(proj.confirmed)} confirmed</li>
          </ul>}
          <p className="small muted" style={{ marginBottom: 0 }}>{proj.assumptions}</p>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-h"><h2>Funnel</h2><span className="small muted">% = conversion from the step above</span></div>
          <Funnel stages={stages as any} />
        </div>
        <div className="card">
          <div className="card-h"><h2>What changed in the last 7 days</h2><span className="small muted num">{fmtInt(totalLast7)} registrations vs {fmtInt(totalPrev7)} the week before</span></div>
          {drivers.length === 0 ? <div className="empty">No registrations in the last 14 days.</div> :
            <table className="t"><thead><tr><th>Campaign</th><th className="r">Last 7d</th><th className="r">Prior 7d</th><th className="r">Change</th></tr></thead>
              <tbody>{drivers.map((c) => <tr key={c.campaign_id}><td>{c.name}</td><td className="r">{c.regs_last7}</td><td className="r">{c.regs_prev7}</td><td className="r" style={{ color: c.delta < 0 ? "var(--critical-ink)" : c.delta > 0 ? "var(--good-ink)" : undefined }}>{c.delta > 0 ? "+" : ""}{c.delta}</td></tr>)}</tbody></table>}
          <h3 style={{ margin: "16px 0 6px" }}>Bottlenecks</h3>
          {d.bottlenecks.length === 0 ? <div className="small muted">No step is more than 15% below the blended rate.</div> :
            <ul className="list small">{d.bottlenecks.slice(0, 5).map((b: any, i: number) => <li key={i}><b>{b.name}</b>: {b.step} {fmtPct(b.rate, 1)} vs {fmtPct(b.blended, 1)} blended ({fmtPct(b.gap, 0)})</li>)}</ul>}
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h2>Campaign scorecard</h2><span className="small muted">Recommendation uses {d.phase === "post" ? "cost per verified attendee and show rate" : "cost per confirmed registration and cancellations"} vs the blended rate. Click a row for detail.</span></div>
        <div className="scroll-x">
          <table className="t">
            <thead><tr><th>Campaign</th><th>Owner</th><th className="r">Spend</th><th className="r">Budget (sim.)</th><th className="r">People</th><th className="r">Regs</th><th className="r">Confirmed</th><th className="r">Attendees</th><th className="r">Target (sim.)</th><th className="r">₹ / {d.phase === "post" ? "attendee" : "confirmed"}</th><th>Call</th><th className="r">Open tasks</th></tr></thead>
            <tbody>
              {camp.map((c) => {
                const r = recs[c.campaign_id];
                return (
                  <tr key={c.campaign_id} className="click" onClick={() => router.push(`/campaigns/${c.campaign_id}`)}>
                    <td><b>{c.name}</b>{c.status !== "active" && <> <span className="tag">{c.status}</span></>}</td>
                    <td>{c.owner_name}</td>
                    <td className="r">{fmtInrK(c.spend)}</td>
                    <td className="r">{fmtInrK(c.planned_budget_inr)}</td>
                    <td className="r">{fmtInt(c.people)}</td>
                    <td className="r">{fmtInt(c.registrations)}</td>
                    <td className="r">{fmtInt(c.confirmed)}</td>
                    <td className="r">{fmtInt(c.attendees)}</td>
                    <td className="r">{fmtInt(c.attendee_target)}</td>
                    <td className="r">{fmtInr(r?.value)}</td>
                    <td title={r?.reasons.join("\n")}><ActionPill action={r?.action ?? "hold"} /></td>
                    <td className="r">{c.open_tasks}{c.overdue_tasks ? <span className="err"> ({c.overdue_tasks} late)</span> : ""}</td>
                  </tr>
                );
              })}
              {d.walkInAttendees > 0 && <tr><td className="muted">Walk-ins (no campaign)</td><td /><td className="r">–</td><td /><td /><td /><td /><td className="r">{fmtInt(d.walkInAttendees)}</td><td /><td /><td /><td /></tr>}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Per-campaign budgets and attendee targets are <span className="tag sim">simulated</span> planning inputs (the source data only has a total budget and event-level goals). Edit them on each campaign page.</p>
      </div>
    </div>
  );
}

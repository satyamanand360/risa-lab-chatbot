"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/components/Shell";
import { api, fmtInt, fmtInr, fmtDate } from "@/lib/format";

export default function DataPage() {
  const { asOf, version } = useApp();
  const [d, setD] = useState<any>(null);
  const [ov, setOv] = useState<any>(null);
  useEffect(() => { api(`/api/quality?asOf=${asOf}`).then(setD); api(`/api/overview?asOf=${asOf}`).then(setOv); }, [asOf, version]);
  if (!d || !ov) return <div className="empty">Loading…</div>;
  return (
    <div className="grid" style={{ gap: 16 }}>
      <h1>Data and definitions</h1>
      <div className="grid g2">
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Metric definitions</h2>
          <ul className="list">
            <li><b>Verified attendee</b>: a distinct external person with an admitted and verified check-in on or before the selected date. Repeat admissions count once; walk-ins count; staff, internal and test people do not.</li>
            <li><b>Registration status</b>: the latest status version effective on or before the selected date. Later changes never leak into earlier dates.</li>
            <li><b>Identified people</b>: external people first seen on or before the date, credited to their first campaign.</li>
            <li><b>Platform counts</b> (impressions, clicks, reach, sessions, registration starts) are anonymous events, not people.</li>
            <li><b>Spend</b> is net of credits, on the posting date.</li>
            <li><b>Goals and budget</b> follow the plan in force on the selected date. The revised plan replaced the launch plan on 15 Mar 2025.</li>
            <li><b>Attribution</b> is observational (campaign recorded on the registration or check-in), not proof of incremental impact.</li>
            <li><b>Projection</b> before the event: registrations at the last-14-day run-rate to event day × current confirmed share × 75% assumed show rate + 100 walk-ins.</li>
          </ul>
        </div>
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Goal history</h2>
          <table className="t"><thead><tr><th>Plan</th><th>From</th><th className="r">People</th><th className="r">Regs</th><th className="r">Attendees</th><th className="r">Budget</th></tr></thead>
            <tbody>{ov.targetHistory.map((t: any) => <tr key={t.version}><td>{t.version} {t.in_force && <span className="tag">in force</span>}</td><td>{fmtDate(t.effective_at)}</td><td className="r">{fmtInt(t.people_goal)}</td><td className="r">{fmtInt(t.registration_goal)}</td><td className="r">{fmtInt(t.visitor_goal)}</td><td className="r">{fmtInr(t.budget_inr)}</td></tr>)}</tbody></table>
          <h2 style={{ margin: "16px 0 8px" }}>Data quality handling</h2>
          <table className="t"><thead><tr><th>Table</th><th className="r">Source rows</th><th className="r">Exact duplicates removed</th></tr></thead>
            <tbody>{d.duplicates.map((x: any) => <tr key={x.name}><td>{x.name.replace(/_/g, " ")}</td><td className="r">{fmtInt(x.rows_in_source)}</td><td className="r">{fmtInt(x.exact_duplicates_removed)}</td></tr>)}</tbody></table>
          <ul className="list small" style={{ marginTop: 10 }}>
            <li>{fmtInt(d.non_external_people)} internal, staff and test people excluded ({Object.entries(d.people_by_type || {}).map(([k, v]) => `${k} ${v}`).join(", ")}).</li>
            <li>{fmtInt(d.excluded_checkins)} check-in rows not admitted+verified, {fmtInt(d.non_external_checkins)} from non-external people, {fmtInt(d.repeat_admissions)} repeat admissions (as of {fmtDate(asOf)}).</li>
            <li>{fmtInt(d.credit_rows)} negative spend (credit) rows totalling {fmtInr(d.credit_total)}.</li>
            <li>{fmtInt(d.post_event_rows)} daily rows dated after the event starts ({fmtInr(d.post_event_spend)} after it ends) are kept as posted.</li>
          </ul>
        </div>
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Sourced vs simulated</h2>
        <p className="small">Sourced: everything in the RISA attendee dataset (campaigns, daily marketing, people, interactions, registrations and status history, check-ins, targets). Simulated: per-campaign planned budgets and attendee targets (tagged <span className="tag sim">simulated</span>), five seed tasks, and the 2026 Bengaluru plan assumptions. Data you enter in the app is tagged <span className="tag user">entered in app</span>.</p>
        <p className="small" style={{ marginBottom: 0 }}>Not in the data: demographics, college names or locations, ticket prices or revenue, satisfaction, competitor data, or creative-level ad detail. The AI analyst says so when asked.</p>
      </div>
    </div>
  );
}

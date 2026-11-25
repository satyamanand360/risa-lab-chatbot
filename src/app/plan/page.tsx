"use client";
import { useMemo, useState } from "react";
import { runPlan, PRESETS, BASELINE_2025, BASELINE_TOTAL_2025, PlanInputs } from "@/lib/plan";
import { useApp } from "@/components/Shell";
import { fmtInt, fmtInr, fmtInrK, fmtPct } from "@/lib/format";

const NUM_FIELDS: { k: keyof PlanInputs; label: string; step: number; pct?: boolean; hint: string }[] = [
  { k: "collegesPitched", label: "Colleges pitched", step: 10, hint: "A: of 1,058+ in Bengaluru Urban (AISHE)" },
  { k: "signRate", label: "Club sign rate", step: 0.01, pct: true, hint: "A: pilot will validate" },
  { k: "regsPerCollege", label: "Registrations per partner college", step: 1, hint: "A: group pass size" },
  { k: "referralRate", label: "Referred regs per 100 other regs", step: 0.01, pct: true, hint: "S: 14 in 2025" },
  { k: "showRate", label: "Confirmed → attended", step: 0.01, pct: true, hint: "S: 77% in 2025" },
  { k: "walkIns", label: "Walk-ins", step: 25, hint: "S: 125 in 2025" },
  { k: "budgetK", label: "Total budget (₹k)", step: 10, hint: "S: ₹300k revised budget" },
  { k: "capacityPerDay", label: "Gate capacity per day", step: 100, hint: "A: venue assumption" },
];
const SPEND = ["Campus Ambassadors", "Community Groups", "Organic Search", "Paid Social", "Creator Partners"];

export default function Plan() {
  const { openChat } = useApp();
  const [p, setP] = useState<PlanInputs>(PRESETS.base);
  const r = useMemo(() => runPlan(p), [p]);
  const set = (k: keyof PlanInputs, v: number) => setP({ ...p, [k]: v });
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row between">
        <div><h1>Plan 2026: Bengaluru</h1><div className="small muted">The quantitative model behind the strategy deck. 2025 channel results are sourced (S); everything you can edit here is an assumption (A).</div></div>
        <div className="row"><button className="btn" onClick={() => setP(PRESETS.base)}>Base case</button><button className="btn" onClick={() => setP(PRESETS.stretch)}>Stretch</button>
          <button className="btn primary" onClick={() => openChat("Using the planning model, what is the most robust way to reach 3,000 verified attendees on ₹3.0L? Show which assumption matters most and test the downside.")}>Ask AI to stress-test</button></div>
      </div>
      <div className="grid g4">
        <div className="card stat"><div className="label">Projected verified attendees</div><div className="value">{fmtInt(r.attendees)}</div><div className="sub">{r.vs2025 >= 0 ? "+" : ""}{fmtInt(r.vs2025)} vs 2025 ({fmtInt(BASELINE_TOTAL_2025.attendees)})</div></div>
        <div className="card stat"><div className="label">Spend</div><div className="value">{fmtInrK(r.spendK * 1000)}</div><div className="sub">{r.overBudget ? <span className="err">Over budget by {fmtInrK(-r.reserveK * 1000)}</span> : `${fmtInrK(r.reserveK * 1000)} reserve`}</div></div>
        <div className="card stat"><div className="label">Cost per attendee</div><div className="value">{fmtInr(r.costPerAttendee)}</div><div className="sub">2025: {fmtInr((BASELINE_TOTAL_2025.spend * 1000) / BASELINE_TOTAL_2025.attendees)}</div></div>
        <div className="card stat"><div className="label">Day 1 load</div><div className="value">{fmtInt(r.capacity.day1)}</div><div className="sub">{r.capacity.ok ? "within" : <span className="err">exceeds</span>} {fmtInt(r.capacity.perDay)}/day capacity (70% of first visits on Day 1 in 2025)</div></div>
      </div>
      <div className="grid g21">
        <div className="card">
          <div className="card-h"><h2>By channel</h2></div>
          <table className="t"><thead><tr><th>Channel</th><th className="r">Spend</th><th className="r">Regs</th><th className="r">Attendees</th><th className="r">₹/attendee</th><th className="r">vs 2025</th><th>Basis</th></tr></thead>
            <tbody>{r.rows.map((x) => <tr key={x.channel}><td><b>{x.channel}</b><div className="small muted">2025: {fmtInrK((BASELINE_2025[x.channel]?.spend ?? 0) * 1000)}, {fmtInt(BASELINE_2025[x.channel]?.attendees)} attendees</div></td><td className="r">{fmtInrK(x.spendK * 1000)}</td><td className="r">{fmtInt(x.regs)}</td><td className="r">{fmtInt(x.attendees)}</td><td className="r">{fmtInr(x.costPerAttendee)}</td><td className="r">{x.vs2025 >= 0 ? "+" : ""}{fmtInt(x.vs2025)}</td><td className="small muted">{x.basis}</td></tr>)}
              <tr><td><b>Show-up engine</b></td><td className="r">{fmtInrK(p.showEngineK * 1000)}</td><td /><td className="r small">in rates above</td><td /><td /><td className="small muted">reminders, waitlist backfill</td></tr>
              <tr><td><b>Walk-ins</b></td><td /><td /><td className="r">{fmtInt(r.walkIns)}</td><td /><td className="r">{r.walkIns - 125 >= 0 ? "+" : ""}{r.walkIns - 125}</td><td /></tr></tbody></table>
        </div>
        <div className="card">
          <div className="card-h"><h2>Assumptions</h2></div>
          <div className="grid" style={{ gap: 10 }}>
            {NUM_FIELDS.map((f) => (
              <div className="field" key={f.k}><label>{f.label} <span className="muted">· {f.hint}</span></label>
                <input type="number" step={f.pct ? 1 : f.step} value={f.pct ? Math.round((p[f.k] as number) * 100) : (p[f.k] as number)} onChange={(e) => set(f.k, f.pct ? Number(e.target.value) / 100 : Number(e.target.value))} /></div>
            ))}
            <h3 style={{ marginTop: 6 }}>Channel spend (₹k)</h3>
            {SPEND.map((ch) => (
              <div className="field" key={ch}><label>{ch} <span className="muted">· 2025: ₹{BASELINE_2025[ch].spend}k</span></label>
                <input type="number" min={0} step={5} value={p.spendK[ch] ?? 0} onChange={(e) => setP({ ...p, spendK: { ...p.spendK, [ch]: Number(e.target.value) } })} /></div>
            ))}
          </div>
        </div>
      </div>
      <p className="small muted">Method: scaled channels follow diminishing returns, attendees = 2025 attendees × (new spend ÷ 2025 spend)^e, with e = 0.85 for ambassadors, communities and organic, 0.6 for paid and creators. Show-rate changes scale every channel and are capped at 92% of registrations. Confirmed → attended in 2025 was {fmtPct(BASELINE_TOTAL_2025.showRate)} (sourced).</p>
    </div>
  );
}

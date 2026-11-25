"use client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, ReferenceLine } from "recharts";
import { fmtInt, fmtPct, fmtDate, fmtInr } from "@/lib/format";

const tick = { fontSize: 11, fill: "#666666" };
const shortDate = (d: string) => new Date(d + "T00:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export function TrendChart({ data, eventStart, showPace = true }: { data: any[]; eventStart?: string; showPace?: boolean }) {
  if (!data.length) return <div className="empty">No data before this date.</div>;
  return (
    <div>
      <div className="legend" style={{ marginBottom: 6 }}>
        <span><i style={{ background: "var(--s1)" }} />Registrations (cumulative)</span>
        <span><i style={{ background: "var(--s2)" }} />Verified attendees (cumulative)</span>
        {showPace && <span><i className="dash" />Registration pace to goal in force</span>}
      </div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#e7e7e7" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={tick} minTickGap={40} axisLine={{ stroke: "#c2c2c2" }} tickLine={false} />
            <YAxis tick={tick} tickFormatter={(v) => fmtInt(v)} width={52} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v: any, n: any) => [fmtInt(v), n]} labelFormatter={(l: any) => fmtDate(l)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            {eventStart && <ReferenceLine x={eventStart} stroke="#c2c2c2" label={{ value: "Event", position: "insideTopRight", fontSize: 11, fill: "#666" }} />}
            {showPace && <Line type="monotone" dataKey="registrationPace" name="Pace to goal" stroke="#8a93a3" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
            <Line type="monotone" dataKey="registrations" name="Registrations" stroke="var(--s1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="attendees" name="Verified attendees" stroke="var(--s2)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function DailyBars({ data, dataKey, name, money }: { data: any[]; dataKey: string; name: string; money?: boolean }) {
  const rows = data.slice(-56);
  return (
    <div style={{ height: 180 }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke="#e7e7e7" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={tick} minTickGap={30} axisLine={{ stroke: "#c2c2c2" }} tickLine={false} />
          <YAxis tick={tick} width={52} tickFormatter={(v) => (money ? fmtInr(v) : fmtInt(v))} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v: any) => [money ? fmtInr(v) : fmtInt(v), name]} labelFormatter={(l: any) => fmtDate(l)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey={dataKey} name={name} fill="var(--s1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Funnel({ stages }: { stages: { key: string; label: string; value: number; kind: string; rateFromPrev: number | null }[] }) {
  const platform = stages.filter((s) => s.kind === "platform count");
  const people = stages.filter((s) => s.kind === "people");
  const maxP = Math.max(1, ...platform.map((s) => s.value));
  const maxH = Math.max(1, ...people.map((s) => s.value));
  const row = (s: any, max: number, i: number, first: boolean) => (
    <div className="fr" key={s.key} title={`${s.label}: ${fmtInt(s.value)}`}>
      <div className="small">{s.label}</div>
      <div className="track"><div className={"fill" + (s.kind === "platform count" ? " platform" : "")} style={{ width: `${Math.max(1, (s.value / max) * 100)}%` }} /></div>
      <div className="r num" style={{ textAlign: "right" }}>{fmtInt(s.value)}</div>
      <div className="small muted num" style={{ textAlign: "right" }}>{first || s.rateFromPrev == null ? "" : fmtPct(s.rateFromPrev, 1)}</div>
    </div>
  );
  return (
    <div className="funnel">
      <div className="sep" style={{ borderTop: 0, paddingTop: 0 }}>Platform counts (anonymous events, not people)</div>
      {platform.map((s, i) => row(s, maxP, i, i === 0))}
      <div className="sep">Identified people (deduplicated, external only)</div>
      {people.map((s, i) => row(s, maxH, i, i === 0))}
    </div>
  );
}

export function ActionPill({ action }: { action: string }) {
  const label: Record<string, string> = { scale: "Scale", hold: "Hold", fix: "Change", stop: "Stop" };
  return <span className={`pill act-${action}`}><span className="dot" />{label[action] ?? action}</span>;
}

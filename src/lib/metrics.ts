import "server-only";
import { q, q1 } from "./db";

/** Planning assumptions used only for forward projections. They are not in the source data. */
export const ASSUMPTIONS = {
  showRate: 0.75,
  walkInAllowance: 100,
  runRateWindowDays: 14,
  note: "Before the event, attendance is projected with an assumed 75% show rate for confirmed registrants plus 100 walk-ins. After check-ins start, actual figures replace the assumption.",
};

export type Meta = Awaited<ReturnType<typeof getMeta>>;

export function cutoff(asOf: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("asOf must be YYYY-MM-DD");
  return `${asOf}T23:59:59.999+05:30`;
}

const DAY = 86400000;
const toDate = (s: string) => new Date(`${s}T00:00:00+05:30`);
export const addDays = (s: string, n: number) => new Date(toDate(s).getTime() + n * DAY + 5.5 * 3600000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
const istDate = (ts: string | Date) => new Date(new Date(ts).getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;
const div = (a: number, b: number) => (b ? a / b : null);

export async function getMeta() {
  const [ev, campaigns, maxData, owners] = await Promise.all([
    q1<any>(`SELECT name, history_start, history_end, starts_at, ends_at FROM event WHERE id=1`),
    q<any>(`SELECT id, name, channel, owner_name, status FROM campaigns ORDER BY id`),
    q1<any>(`SELECT GREATEST(
      (SELECT max(activity_date) FROM daily_marketing), (SELECT max(registered_at)::date FROM registrations), (SELECT max(occurred_at)::date FROM checkins)) AS d`),
    q<any>(`SELECT DISTINCT owner_name FROM campaigns WHERE owner_name IS NOT NULL ORDER BY 1`)]);
  return {
    event: { name: ev.name, historyStart: ev.history_start as string, historyEnd: ev.history_end as string, startsAt: new Date(ev.starts_at).toISOString(), endsAt: new Date(ev.ends_at).toISOString(), startDate: istDate(ev.starts_at), endDate: istDate(ev.ends_at) },
    latestDataDate: (maxData?.d as string) ?? ev.history_end,
    campaigns,
    owners: owners.map((o) => o.owner_name as string),
  };
}

export async function targetAt(asOf: string) {
  const t = await q1<any>(`SELECT * FROM targets WHERE effective_at <= $1 ORDER BY effective_at DESC LIMIT 1`, [cutoff(asOf)]);
  const all = await q<any>(`SELECT version, effective_at, people_goal, registration_goal, visitor_goal, budget_inr FROM targets ORDER BY effective_at`);
  return { current: t, history: all.map((x) => ({ ...x, effective_at: new Date(x.effective_at).toISOString(), in_force: new Date(x.effective_at) <= new Date(cutoff(asOf)) })) };
}

const REGS_SQL = `
  WITH st AS (
    SELECT DISTINCT ON (h.registration_id) h.registration_id, h.status
    FROM registration_history h WHERE h.effective_at <= $1
    ORDER BY h.registration_id, h.effective_at DESC, h.history_id DESC)
  SELECT r.registration_id, r.person_id, COALESCE(r.campaign_id,'UNATTRIBUTED') AS campaign_id, r.registered_at, COALESCE(st.status,'interested') AS status
  FROM registrations r JOIN people p ON p.person_id = r.person_id AND p.person_type = 'external'
  LEFT JOIN st ON st.registration_id = r.registration_id
  WHERE r.registered_at <= $1`;

const ATTENDEES_SQL = `
  SELECT DISTINCT ON (c.person_id) c.person_id, COALESCE(c.campaign_id, 'WALKIN') AS campaign_id, c.registration_id, c.occurred_at
  FROM checkins c JOIN people p ON p.person_id = c.person_id AND p.person_type = 'external'
  WHERE c.result = 'admitted' AND c.verification = 'verified' AND c.occurred_at <= $1
  ORDER BY c.person_id, c.occurred_at`;

type CampaignRow = {
  campaign_id: string; name: string; channel: string; owner_name: string; status: string; planned_budget_inr: number | null; attendee_target: number | null; plan_source: string | null;
  impressions: number; clicks: number; sessions: number; registration_starts: number; spend: number;
  people: number; registrations: number; confirmed: number; cancelled: number; waitlisted: number; interested: number; attendees: number;
  regs_last7: number; regs_prev7: number; open_tasks: number; overdue_tasks: number;
};

export async function campaignTable(asOf: string): Promise<CampaignRow[]> {
  const c = cutoff(asOf);
  const rows = await q<any>(`
    WITH regs AS (${REGS_SQL}),
    att AS (${ATTENDEES_SQL}),
    dm AS (SELECT campaign_id, sum(impressions) impressions, sum(clicks) clicks, sum(sessions) sessions, sum(registration_starts) registration_starts, sum(spend_inr) spend
           FROM daily_marketing WHERE activity_date <= $2::date GROUP BY campaign_id),
    ppl AS (SELECT first_campaign_id AS campaign_id, count(*) n FROM people WHERE person_type='external' AND first_seen_at <= $1 GROUP BY 1),
    rg AS (SELECT campaign_id, count(*) registrations,
             count(*) FILTER (WHERE status='confirmed') confirmed, count(*) FILTER (WHERE status='cancelled') cancelled,
             count(*) FILTER (WHERE status='waitlisted') waitlisted, count(*) FILTER (WHERE status='interested') interested,
             count(*) FILTER (WHERE registered_at > $1::timestamptz - interval '7 days') regs_last7,
             count(*) FILTER (WHERE registered_at <= $1::timestamptz - interval '7 days' AND registered_at > $1::timestamptz - interval '14 days') regs_prev7
           FROM regs GROUP BY campaign_id),
    at AS (SELECT campaign_id, count(*) attendees FROM att GROUP BY 1),
    tk AS (SELECT campaign_id, count(*) FILTER (WHERE status <> 'done') open_tasks, count(*) FILTER (WHERE status <> 'done' AND due_date < $2::date) overdue_tasks FROM tasks GROUP BY 1)
    SELECT cp.id AS campaign_id, cp.name, cp.channel, cp.owner_name, cp.status, cp.planned_budget_inr, cp.attendee_target, cp.plan_source,
      COALESCE(dm.impressions,0) impressions, COALESCE(dm.clicks,0) clicks, COALESCE(dm.sessions,0) sessions, COALESCE(dm.registration_starts,0) registration_starts, COALESCE(dm.spend,0) spend,
      COALESCE(ppl.n,0) people, COALESCE(rg.registrations,0) registrations, COALESCE(rg.confirmed,0) confirmed, COALESCE(rg.cancelled,0) cancelled,
      COALESCE(rg.waitlisted,0) waitlisted, COALESCE(rg.interested,0) interested, COALESCE(at.attendees,0) attendees,
      COALESCE(rg.regs_last7,0) regs_last7, COALESCE(rg.regs_prev7,0) regs_prev7, COALESCE(tk.open_tasks,0) open_tasks, COALESCE(tk.overdue_tasks,0) overdue_tasks
    FROM campaigns cp LEFT JOIN dm ON dm.campaign_id = cp.id LEFT JOIN ppl ON ppl.campaign_id = cp.id
    LEFT JOIN rg ON rg.campaign_id = cp.id LEFT JOIN at ON at.campaign_id = cp.id LEFT JOIN tk ON tk.campaign_id = cp.id
    ORDER BY cp.id`, [c, asOf]);
  return rows.map((r) => {
    const o: any = {};
    for (const [k, v] of Object.entries(r)) o[k] = typeof v === "string" && /^-?\d+$/.test(v) && !["campaign_id", "name", "channel", "owner_name", "status", "plan_source"].includes(k) ? Number(v) : v;
    return o as CampaignRow;
  });
}

export async function overview(asOf: string) {
  const c = cutoff(asOf);
  // Independent queries run in parallel: on a hosted Postgres each round trip costs real latency.
  const [meta, target, camps, totals] = await Promise.all([getMeta(), targetAt(asOf), campaignTable(asOf), q1<any>(`
    WITH regs AS (${REGS_SQL}), att AS (${ATTENDEES_SQL})
    SELECT
      (SELECT count(*) FROM people WHERE person_type='external' AND first_seen_at <= $1) AS people,
      (SELECT count(*) FROM people WHERE person_type<>'external' AND first_seen_at <= $1) AS excluded_people,
      (SELECT count(*) FROM regs) AS registrations,
      (SELECT count(*) FROM regs WHERE status='confirmed') AS confirmed,
      (SELECT count(*) FROM regs WHERE status='cancelled') AS cancelled,
      (SELECT count(*) FROM regs WHERE status='waitlisted') AS waitlisted,
      (SELECT count(*) FROM regs WHERE status='interested') AS interested,
      (SELECT count(*) FROM att) AS attendees,
      (SELECT count(*) FROM att WHERE registration_id IS NULL) AS walk_ins,
      (SELECT count(*) FROM checkins WHERE occurred_at <= $1) AS checkin_rows,
      (SELECT COALESCE(sum(spend_inr),0) FROM daily_marketing WHERE activity_date <= $2::date) AS spend,
      (SELECT COALESCE(sum(impressions),0) FROM daily_marketing WHERE activity_date <= $2::date) AS impressions,
      (SELECT COALESCE(sum(clicks),0) FROM daily_marketing WHERE activity_date <= $2::date) AS clicks,
      (SELECT COALESCE(sum(sessions),0) FROM daily_marketing WHERE activity_date <= $2::date) AS sessions,
      (SELECT COALESCE(sum(registration_starts),0) FROM daily_marketing WHERE activity_date <= $2::date) AS registration_starts,
      (SELECT count(*) FROM daily_marketing WHERE activity_date <= $2::date AND spend_inr < 0) AS credit_rows,
      (SELECT count(*) FROM registrations r WHERE r.registered_at > $1::timestamptz - interval '14 days' AND r.registered_at <= $1
         AND EXISTS (SELECT 1 FROM people p WHERE p.person_id=r.person_id AND p.person_type='external')) AS regs_last14`, [c, asOf])]);
  const t = target.current;
  const phase = asOf < meta.event.startDate ? "pre" : asOf <= meta.event.endDate ? "during" : "post";
  const daysToEvent = Math.max(0, daysBetween(asOf, meta.event.startDate));
  const runRate = totals.regs_last14 / ASSUMPTIONS.runRateWindowDays;
  const projRegs = phase === "pre" ? totals.registrations + runRate * daysToEvent : totals.registrations;
  const confirmedShare = div(totals.confirmed, totals.registrations) ?? 0.9;
  const projConfirmed = projRegs * confirmedShare;
  const projAttendees = phase === "post" ? totals.attendees : phase === "during" ? Math.max(totals.attendees, projConfirmed * ASSUMPTIONS.showRate + ASSUMPTIONS.walkInAllowance) : projConfirmed * ASSUMPTIONS.showRate + ASSUMPTIONS.walkInAllowance;
  const registeredAttendees = totals.attendees - totals.walk_ins;
  return {
    asOf, phase, daysToEvent, event: meta.event,
    target: t ? { version: t.version, effectiveAt: new Date(t.effective_at).toISOString(), people: t.people_goal, registrations: t.registration_goal, attendees: t.visitor_goal, budget: t.budget_inr } : null,
    targetHistory: target.history,
    totals: {
      ...totals,
      registered_attendees: registeredAttendees,
      cost_per_registration: div(totals.spend, totals.registrations),
      cost_per_confirmed: div(totals.spend, totals.confirmed),
      cost_per_attendee: div(totals.spend, totals.attendees),
      show_rate: phase === "pre" ? null : div(registeredAttendees, totals.confirmed),
      budget_used: t ? div(totals.spend, t.budget_inr) : null,
    },
    projection: {
      method: phase === "post" ? "actual" : "run-rate",
      regsPerDayLast14: r1(runRate),
      registrations: Math.round(projRegs),
      confirmed: Math.round(projConfirmed),
      attendees: Math.round(projAttendees),
      vsTarget: t ? Math.round(projAttendees - t.visitor_goal) : null,
      assumptions: phase === "post" ? "Actual verified check-ins." : ASSUMPTIONS.note,
    },
    campaigns: camps,
    walkInAttendees: totals.walk_ins,
  };
}

export type Recommendation = { campaign_id: string; name: string; action: "scale" | "hold" | "fix" | "stop"; reasons: string[]; metric: string; value: number | null; benchmark: number | null };

/** Rules from the strategy deck (slide 3), applied to the as-of data. */
export function recommend(ov: Awaited<ReturnType<typeof overview>>): Recommendation[] {
  const post = ov.phase === "post";
  const tot = ov.campaigns.reduce((a, c) => ({ spend: a.spend + c.spend, confirmed: a.confirmed + c.confirmed, regs: a.regs + c.registrations, cancelled: a.cancelled + c.cancelled, att: a.att + c.attendees }), { spend: 0, confirmed: 0, regs: 0, cancelled: 0, att: 0 });
  const blendedCost = post ? div(tot.spend, tot.att) : div(tot.spend, tot.confirmed);
  const blendedCancel = div(tot.cancelled, tot.regs) ?? 0;
  return ov.campaigns.map((c) => {
    const reasons: string[] = [];
    const cost = post ? div(c.spend, c.attendees) : div(c.spend, c.confirmed);
    const cancel = div(c.cancelled, c.registrations) ?? 0;
    const show = post ? div(c.attendees, c.confirmed) : null;
    const metric = post ? "cost per verified attendee" : "cost per confirmed registration";
    let action: Recommendation["action"] = "hold";
    if (c.registrations < 15) {
      reasons.push(`Only ${c.registrations} registrations so far, too few to judge.`);
      return { campaign_id: c.campaign_id, name: c.name, action, reasons, metric, value: cost, benchmark: blendedCost };
    }
    const ratio = cost != null && blendedCost ? cost / blendedCost : null;
    if (ratio != null) reasons.push(`${metric} ₹${Math.round(cost!)} vs blended ₹${Math.round(blendedCost!)} (${ratio.toFixed(2)}×).`);
    if (cancel > 0) reasons.push(`Cancellation rate ${(cancel * 100).toFixed(1)}% vs ${(blendedCancel * 100).toFixed(1)}% overall.`);
    if (show != null) reasons.push(`Show rate ${(show * 100).toFixed(0)}% of confirmed registrants.`);
    if (c.regs_last7 + c.regs_prev7 > 0) reasons.push(`Registrations last 7 days: ${c.regs_last7} (prior 7: ${c.regs_prev7}).`);
    if ((ratio != null && ratio >= 2) || (show != null && show < 0.55)) action = "stop";
    else if ((ratio != null && ratio >= 1.3) || cancel >= blendedCancel * 1.5 || (show != null && show < 0.65)) action = "fix";
    else if (ratio != null && ratio <= 0.8 && cancel <= blendedCancel + 0.02 && (show == null || show >= 0.75)) action = "scale";
    if (c.status !== "active") reasons.push(`Campaign is currently ${c.status}.`);
    return { campaign_id: c.campaign_id, name: c.name, action, reasons, metric, value: cost, benchmark: blendedCost };
  });
}

/** Funnel stages. Platform counts (impressions to registration starts) are anonymous events, not people. */
export function funnelFrom(rows: { impressions: number; clicks: number; sessions: number; registration_starts: number; people: number; registrations: number; confirmed: number; attendees: number }, walkIns = 0) {
  const stages = [
    { key: "impressions", label: "Impressions", value: rows.impressions, kind: "platform count" },
    { key: "clicks", label: "Clicks", value: rows.clicks, kind: "platform count" },
    { key: "sessions", label: "Landing sessions", value: rows.sessions, kind: "platform count" },
    { key: "registration_starts", label: "Registration starts", value: rows.registration_starts, kind: "platform count" },
    { key: "people", label: "Identified people", value: rows.people, kind: "people" },
    { key: "registrations", label: "Registrations", value: rows.registrations, kind: "people" },
    { key: "confirmed", label: "Confirmed (latest status)", value: rows.confirmed, kind: "people" },
    { key: "attendees", label: "Verified attendees" + (walkIns ? ` (incl. ${walkIns} walk-ins)` : ""), value: rows.attendees, kind: "people" },
  ];
  return stages.map((s, i) => ({ ...s, rateFromPrev: i === 0 ? null : div(s.value, stages[i - 1].value) }));
}

export function bottlenecks(ov: Awaited<ReturnType<typeof overview>>) {
  const post = ov.totals.attendees > 0;
  const steps: { key: string; label: string; num: (c: any) => number; den: (c: any) => number }[] = [
    { key: "ctr", label: "Impression → click", num: (c) => c.clicks, den: (c) => c.impressions },
    { key: "start", label: "Session → registration start", num: (c) => c.registration_starts, den: (c) => c.sessions },
    { key: "reg", label: "Identified person → registration", num: (c) => c.registrations, den: (c) => c.people },
    { key: "confirm", label: "Registration → confirmed", num: (c) => c.confirmed, den: (c) => c.registrations },
    ...(post ? [{ key: "show", label: "Confirmed → attended", num: (c: any) => c.attendees, den: (c: any) => c.confirmed }] : []),
  ];
  const out: any[] = [];
  for (const s of steps) {
    const tn = ov.campaigns.reduce((a, c) => a + s.num(c), 0), td = ov.campaigns.reduce((a, c) => a + s.den(c), 0);
    const blended = div(tn, td);
    for (const c of ov.campaigns) {
      const rate = div(s.num(c), s.den(c));
      if (rate == null || blended == null || s.den(c) < 30) continue;
      const gap = rate / blended - 1;
      if (gap <= -0.15) out.push({ campaign_id: c.campaign_id, name: c.name, step: s.label, rate, blended, gap });
    }
  }
  return out.sort((a, b) => a.gap - b.gap);
}

export async function trend(asOf: string, campaignId?: string | null) {
  const meta = await getMeta();
  const c = cutoff(asOf);
  const params: unknown[] = [c, asOf];
  const cf = campaignId ? ` AND campaign_id = $3` : "";
  if (campaignId) params.push(campaignId);
  const regs = await q<any>(`WITH regs AS (${REGS_SQL}) SELECT (registered_at AT TIME ZONE 'Asia/Kolkata')::date::text d, count(*) n FROM regs WHERE $2::text IS NOT NULL ${cf} GROUP BY 1`, params);
  const att = await q<any>(`WITH att AS (${ATTENDEES_SQL}) SELECT (occurred_at AT TIME ZONE 'Asia/Kolkata')::date::text d, count(*) n FROM att WHERE $2::text IS NOT NULL ${cf} GROUP BY 1`, params);
  const ppl = await q<any>(`SELECT (first_seen_at AT TIME ZONE 'Asia/Kolkata')::date::text d, count(*) n FROM people WHERE person_type='external' AND first_seen_at <= $1 ${campaignId ? "AND first_campaign_id = $3" : ""} AND $2::text IS NOT NULL GROUP BY 1`, params);
  const spend = await q<any>(`SELECT activity_date::text d, sum(spend_inr) n, sum(clicks) clicks, sum(sessions) sessions FROM daily_marketing WHERE activity_date <= $2::date ${cf} AND $1::text IS NOT NULL GROUP BY 1`, params);
  const map = (rows: any[]) => new Map(rows.map((r) => [r.d, Number(r.n)]));
  const mr = map(regs), ma = map(att), mp = map(ppl), ms = map(spend);
  const targets = await q<any>(`SELECT effective_at, registration_goal, visitor_goal FROM targets ORDER BY effective_at`);
  const start = meta.event.historyStart;
  const totalDays = daysBetween(start, meta.event.startDate);
  const out: any[] = [];
  let cr = 0, ca = 0, cp = 0, cs = 0;
  for (let d = start; d <= asOf && d <= meta.event.historyEnd; d = addDays(d, 1)) {
    cr += mr.get(d) ?? 0; ca += ma.get(d) ?? 0; cp += mp.get(d) ?? 0; cs += ms.get(d) ?? 0;
    const tgt = [...targets].reverse().find((t) => istDate(t.effective_at) <= d) ?? targets[0];
    const elapsed = Math.min(1, Math.max(0, daysBetween(start, d) / totalDays));
    out.push({ date: d, registrations: cr, newRegistrations: mr.get(d) ?? 0, attendees: ca, people: cp, spend: cs, dailySpend: ms.get(d) ?? 0,
      registrationPace: campaignId ? null : Math.round(tgt.registration_goal * elapsed), registrationGoal: campaignId ? null : tgt.registration_goal });
  }
  return out;
}

export async function campaignDetail(id: string, asOf: string) {
  const camp = await q1<any>(`SELECT * FROM campaigns WHERE id=$1`, [id]);
  if (!camp) return null;
  const ov = await overview(asOf);
  const row = ov.campaigns.find((c) => c.campaign_id === id)!;
  const daily = await q<any>(`SELECT activity_id, activity_date::text activity_date, impressions, clicks, reported_reach, sessions, registration_starts, spend_inr, platform, source FROM daily_marketing WHERE campaign_id=$1 AND activity_date <= $2::date ORDER BY activity_date DESC`, [id, asOf]);
  const tasks = await q<any>(`SELECT id, title, description, owner_name, due_date::text due_date, status, priority, created_by, rationale FROM tasks WHERE campaign_id=$1 ORDER BY status='done', due_date NULLS LAST`, [id]);
  const engagement = await q<any>(`SELECT event_type, count(*)::int n FROM interactions i JOIN people p ON p.person_id=i.person_id AND p.person_type='external' WHERE i.campaign_id=$1 AND i.occurred_at <= $2 GROUP BY 1 ORDER BY 2 DESC`, [id, cutoff(asOf)]);
  const rec = recommend(ov).find((r) => r.campaign_id === id);
  return { campaign: { ...camp, created_at: camp.created_at && new Date(camp.created_at).toISOString(), planned_start: camp.planned_start && new Date(camp.planned_start).toISOString(), planned_end: camp.planned_end && new Date(camp.planned_end).toISOString(), updated_at: camp.updated_at && new Date(camp.updated_at).toISOString() },
    stats: row, funnel: funnelFrom(row), daily, tasks, engagement, recommendation: rec, trend: await trend(asOf, id), phase: ov.phase };
}

export async function listTasks(filter: { status?: string; campaign_id?: string; owner?: string } = {}) {
  const where: string[] = []; const params: unknown[] = [];
  if (filter.status) { params.push(filter.status); where.push(`t.status = $${params.length}`); }
  if (filter.campaign_id) { params.push(filter.campaign_id); where.push(`t.campaign_id = $${params.length}`); }
  if (filter.owner) { params.push(filter.owner); where.push(`t.owner_name = $${params.length}`); }
  return q<any>(`SELECT t.id, t.title, t.description, t.campaign_id, c.name campaign_name, t.owner_name, t.due_date::text due_date, t.status, t.priority, t.created_by, t.rationale, t.created_at, t.updated_at
    FROM tasks t LEFT JOIN campaigns c ON c.id = t.campaign_id ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, t.due_date NULLS LAST, t.id`, params);
}

export async function dataQuality(asOf: string) {
  const dq = await q<any>(`SELECT * FROM data_quality ORDER BY name`);
  const c = cutoff(asOf);
  const x = await q1<any>(`SELECT
    (SELECT count(*) FROM people WHERE person_type <> 'external') non_external_people,
    (SELECT json_object_agg(person_type, n) FROM (SELECT person_type, count(*) n FROM people GROUP BY 1) s) people_by_type,
    (SELECT count(*) FROM checkins WHERE occurred_at <= $1 AND NOT (result='admitted' AND verification='verified')) excluded_checkins,
    (SELECT count(*) FROM checkins c JOIN people p ON p.person_id=c.person_id WHERE c.occurred_at <= $1 AND p.person_type <> 'external') non_external_checkins,
    (SELECT count(*) - count(DISTINCT person_id) FROM checkins c WHERE c.occurred_at <= $1 AND result='admitted' AND verification='verified') repeat_admissions,
    (SELECT count(*) FROM daily_marketing WHERE spend_inr < 0) credit_rows,
    (SELECT COALESCE(sum(spend_inr),0) FROM daily_marketing WHERE spend_inr < 0) credit_total,
    (SELECT count(*) FROM daily_marketing WHERE activity_date > (SELECT starts_at::date FROM event)) post_event_rows,
    (SELECT COALESCE(sum(spend_inr),0) FROM daily_marketing WHERE activity_date > (SELECT ends_at::date FROM event)) post_event_spend,
    (SELECT count(*) FROM registration_history) history_rows,
    (SELECT count(*) FROM registrations r JOIN people p ON p.person_id=r.person_id WHERE p.person_type<>'external') non_external_registrations`, [c]);
  return { duplicates: dq, ...x };
}

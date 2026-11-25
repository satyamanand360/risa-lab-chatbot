import "server-only";
import { q, q1, readOnly } from "./db";
import { overview, recommend, bottlenecks, campaignDetail, listTasks, getMeta, ASSUMPTIONS, cutoff, dataQuality, addDays } from "./metrics";
import { runPlan, PRESETS, PlanInputs } from "./plan";

// Tried in order. A model that returns 404 (retired, or closed to new projects) is skipped,
// and the first one that answers is remembered for later requests.
const DEFAULT_MODELS = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
let workingModel: string | null = null;
const MAX_STEPS = 10;

export type Proposal =
  | { id: string; kind: "task"; status: "pending" | "confirmed" | "dismissed"; payload: { title: string; description?: string; campaign_id?: string | null; owner_name?: string | null; due_date?: string | null; priority?: string; rationale?: string } }
  | { id: string; kind: "campaign_change"; status: "pending" | "confirmed" | "dismissed"; payload: { campaign_id: string; changes: Record<string, unknown>; rationale?: string } };

const SCHEMA_DOC = `Tables (PostgreSQL). Timestamps are timestamptz; the event runs in IST (Asia/Kolkata).
- campaigns(id, name, channel, audience, objective, owner_name, status ['active','paused','stopped'], planned_budget_inr, attendee_target, plan_source ['simulated','user'], planned_start, planned_end)
- daily_marketing(activity_id, campaign_id, activity_date DATE, impressions, clicks, reported_reach, sessions, registration_starts, spend_inr, platform, source ['dataset','user']) -- anonymous platform counts; spend is net (credits are negative)
- people(person_id, person_name, person_type ['external','internal','staff','test'], first_seen_at, first_touch_source ['campaign','walk_in'], first_campaign_id)
- interactions(interaction_id, person_id, campaign_id, occurred_at, event_type ['page_visit','registration_start','brochure_download','nurture_email_sent','nurture_email_opened','nurture_email_clicked','opted_out','event_question_submitted'])
- registrations(registration_id, person_id, campaign_id, registered_at)
- registration_history(history_id, registration_id, effective_at, status ['interested','confirmed','waitlisted','cancelled']) -- versioned; the status as of a date is the latest row with effective_at <= that date
- checkins(event_id, person_id, registration_id NULL for walk-ins, campaign_id, occurred_at, result ['admitted','denied','pending'], verification ['verified','unverified'], source ['scanner','manual'])
- targets(effective_at, version, people_goal, registration_goal, visitor_goal, budget_inr) -- the goal in force is the latest row with effective_at <= date
- tasks(id, title, description, campaign_id, owner_name, due_date, status ['todo','in_progress','done'], priority, created_by ['user','ai'])
Rules: count only person_type='external'. An attendee is a distinct person with a check-in where result='admitted' AND verification='verified'. Never count reach or impressions as people. Respect the as-of cutoff: filter every timestamp <= '<as_of>T23:59:59.999+05:30'.`;

const DEFINITIONS = {
  attendee: "Distinct external person with at least one check-in that is admitted AND verified, on or before the as-of date. Repeat admissions count once. Walk-ins (no registration) count; staff, internal and test people do not.",
  registration: "A registration by an external person on or before the as-of date. Its status is the latest registration_history version effective on or before the as-of date (no future leakage).",
  identified_people: "External people first seen on or before the as-of date, attributed to their first campaign.",
  platform_counts: "Impressions, clicks, reach, landing sessions and registration starts are anonymous platform event counts. They are not people and are not deduplicated across days or campaigns.",
  spend: "Net marketing spend in INR on or before the as-of date. Credit rows are negative and reduce spend on their posting date.",
  goals: "Goals and total budget come from the targets table. The launch plan (15 Jan 2025) was replaced by the revised plan on 15 Mar 2025 (attendees 1,800 → 2,200, budget ₹2.4L → ₹3.0L). Use the plan in force on the as-of date.",
  per_campaign_budget_and_target: "Not in the source data. The app seeds simulated per-campaign budgets and attendee targets (plan_source='simulated') that users can edit; say so whenever you use them.",
  attribution: "Observational, by the campaign recorded on the registration or check-in. It shows association, not proven incremental impact.",
  projection: ASSUMPTIONS.note,
  not_available: "The data has no demographics, college names, locations, ticket prices or revenue, survey or satisfaction data, competitor data, sponsor revenue (separate dataset), or per-ad creative detail.",
};

type ToolDef = { name: string; description: string; input_schema: any };

const tools: ToolDef[] = [
  { name: "get_overview", description: "Headline KPIs as of a date: identified people, registrations by latest status, verified attendees, walk-ins, net spend, cost per registration/attendee, the goal and budget in force, days to event, and the run-rate projection. Start here for status questions.",
    input_schema: { type: "object", properties: { as_of: { type: "string", description: "YYYY-MM-DD; defaults to the date the user has selected" } }, additionalProperties: false } },
  { name: "compare_campaigns", description: "Per-campaign table as of a date: spend, simulated planned budget and attendee target, platform counts, identified people, registrations by status, verified attendees, registrations in the last 7 vs prior 7 days, open and overdue tasks, derived conversion rates and cost metrics, plus the rule-based recommendation (scale/hold/change/stop with reasons) and funnel bottlenecks.",
    input_schema: { type: "object", properties: { as_of: { type: "string" } }, additionalProperties: false } },
  { name: "get_campaign", description: "Deep dive on one campaign as of a date: details, funnel, engagement events by type, the 14 most recent daily marketing rows, tasks, recommendation and weekly trend.",
    input_schema: { type: "object", properties: { campaign_id: { type: "string", description: "e.g. C02" }, as_of: { type: "string" } }, required: ["campaign_id"], additionalProperties: false } },
  { name: "get_weekly_trend", description: "Weekly series (Monday-start weeks, IST) of new registrations, cancellations recorded, new verified attendees and net spend, optionally for one campaign. Use to explain trends and what drove a change.",
    input_schema: { type: "object", properties: { as_of: { type: "string" }, campaign_id: { type: "string" } }, additionalProperties: false } },
  { name: "list_tasks", description: "Tasks in the management tool, with owner, due date, status, priority and linked campaign. Overdue = not done and due before the as-of date.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["todo", "in_progress", "done"] }, campaign_id: { type: "string" }, owner: { type: "string" } }, additionalProperties: false } },
  { name: "run_sql", description: `Run one read-only SELECT (or WITH ... SELECT) query for questions the other tools don't cover. Max 200 rows returned. Apply the as-of cutoff yourself.\n${SCHEMA_DOC}`,
    input_schema: { type: "object", properties: { sql: { type: "string" }, purpose: { type: "string", description: "One line on what this answers" } }, required: ["sql", "purpose"], additionalProperties: false } },
  { name: "get_definitions", description: "Metric definitions, data-quality handling (duplicates removed, excluded records, credits) and the list of things the data cannot answer. Use before answering anything about definitions or data limits.",
    input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "simulate_plan", description: "Run the 2026 Bengaluru planning model from the strategy deck. Starts from the 'base' or 'stretch' preset and applies overrides; returns projected registrations, verified attendees, spend, cost per attendee and capacity check by channel. Results are projections built on assumptions, not data.",
    input_schema: { type: "object", properties: {
      preset: { type: "string", enum: ["base", "stretch"] },
      overrides: { type: "object", description: "Inputs to change from the preset. Omit any you don't change.", properties: {
        collegesPitched: { type: "integer" }, signRate: { type: "number", description: "0-1" }, regsPerCollege: { type: "number" },
        referralRate: { type: "number", description: "referred registrations per other registration, 0-1" }, showRate: { type: "number", description: "0-1" },
        walkIns: { type: "integer" }, budgetK: { type: "number", description: "total budget, ₹ thousands" }, capacityPerDay: { type: "integer" },
        spendK: { type: "object", description: "Channel spend in ₹ thousands", properties: { organic_search: { type: "number" }, community_groups: { type: "number" }, campus_ambassadors: { type: "number" }, paid_social: { type: "number" }, creator_partners: { type: "number" } } } } } },
      required: ["preset"], additionalProperties: false } },
  { name: "propose_task", description: "Propose a task for the management tool. This does NOT create it: the user sees a card and must confirm. Use when the user asks to act on a recommendation or when a concrete next step follows from the data. Give a specific title, owner (a campaign owner when relevant), due date and the data-backed rationale.",
    input_schema: { type: "object", properties: {
      title: { type: "string" }, description: { type: "string" }, campaign_id: { type: "string" }, owner_name: { type: "string" },
      due_date: { type: "string", description: "YYYY-MM-DD" }, priority: { type: "string", enum: ["low", "medium", "high"] }, rationale: { type: "string" } },
      required: ["title", "rationale"], additionalProperties: false } },
  { name: "propose_campaign_change", description: "Propose changing a campaign's status (active/paused/stopped), simulated planned budget, attendee target or owner. Does NOT apply it: the user must confirm on a card.",
    input_schema: { type: "object", properties: {
      campaign_id: { type: "string" },
      changes: { type: "object", properties: { status: { type: "string", enum: ["active", "paused", "stopped"] }, planned_budget_inr: { type: "integer" }, attendee_target: { type: "integer" }, owner_name: { type: "string" } }, additionalProperties: false },
      rationale: { type: "string" } }, required: ["campaign_id", "changes", "rationale"], additionalProperties: false } },
];

function systemPrompt(asOf: string, meta: Awaited<ReturnType<typeof getMeta>>) {
  return `You are the AI growth analyst inside the Growth Center for ${meta.event.name}, a two-day college festival (${meta.event.startDate} to ${meta.event.endDate}, IST, currency INR). The team's goal is to maximise verified attendees. You help them understand performance, diagnose problems, decide what to scale, change or stop, and turn decisions into tasks.

The user is looking at data as of ${asOf} (end of day IST). Use that date for every tool call unless the user names another date. Data exists from ${meta.event.historyStart} to ${meta.event.historyEnd}. Campaigns: ${meta.campaigns.map((c) => `${c.id} ${c.name} (owner ${c.owner_name}${c.status !== "active" ? ", " + c.status : ""})`).join("; ")}.

How to work:
- Answer from tool results, never from general marketing knowledge. Call tools before giving any number; recompute rather than guess. Show the key figures and how you derived them (for example "₹93,000 / 340 attendees = ₹274").
- Separate evidence from assumption. Label projections, simulated budgets/targets and planning-model outputs as assumptions. Attribution is observational, so say "associated with", not "caused".
- If the data cannot answer (see get_definitions → not_available), say so plainly, say what data would be needed, and offer the closest answer the data does support. Do not invent figures.
- For "what should we do" questions, recommend specific actions ranked by expected impact on verified attendees, each with the supporting numbers, the main risk, and a threshold for scaling or stopping.
- When an action would help, propose it with propose_task or propose_campaign_change. Nothing is saved until the user confirms on the card, so tell them it is waiting for their confirmation.
- Messages may start with a bracketed note about proposals the user confirmed or dismissed; treat it as fact.
- Be concise: lead with the answer in one or two sentences, then the evidence. Use short bullet lists or a small markdown table when comparing campaigns. No preamble.`;
}

export async function execTool(name: string, input: any, ctx: { asOf: string; proposals: Proposal[] }) {
  const asOf = typeof input?.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.as_of) ? input.as_of : ctx.asOf;
  switch (name) {
    case "get_overview": {
      const ov = await overview(asOf);
      return { as_of: asOf, phase: ov.phase, days_to_event: ov.daysToEvent, goal_in_force: ov.target, goal_history: ov.targetHistory, totals: ov.totals, projection: ov.projection };
    }
    case "compare_campaigns": {
      const ov = await overview(asOf);
      const recs = recommend(ov);
      const r = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : null);
      return {
        as_of: asOf, phase: ov.phase,
        campaigns: ov.campaigns.map((c) => ({ ...c,
          ctr: r(c.clicks, c.impressions), people_to_registration: r(c.registrations, c.people), confirmed_share: r(c.confirmed, c.registrations),
          cancel_rate: r(c.cancelled, c.registrations), show_rate_of_confirmed: ov.phase === "pre" ? null : r(c.attendees, c.confirmed),
          cost_per_registration: c.registrations ? Math.round(c.spend / c.registrations) : null, cost_per_confirmed: c.confirmed ? Math.round(c.spend / c.confirmed) : null,
          cost_per_attendee: c.attendees ? Math.round(c.spend / c.attendees) : null, budget_used: c.planned_budget_inr ? r(c.spend, c.planned_budget_inr) : null,
          recommendation: recs.find((x) => x.campaign_id === c.campaign_id) })),
        walk_in_attendees: ov.walkInAttendees, bottlenecks: bottlenecks(ov).slice(0, 8),
        note: "planned_budget_inr and attendee_target are simulated planning inputs unless plan_source='user'.",
      };
    }
    case "get_campaign": {
      const d = await campaignDetail(String(input.campaign_id || "").toUpperCase(), asOf);
      if (!d) return { error: `No campaign ${input.campaign_id}. Valid ids: ${(await getMeta()).campaigns.map((c) => c.id).join(", ")}` };
      const weekly = await weeklyTrend(asOf, d.campaign.id);
      return { as_of: asOf, campaign: d.campaign, stats: d.stats, funnel: d.funnel, engagement: d.engagement, recent_daily: d.daily.slice(0, 14), tasks: d.tasks, recommendation: d.recommendation, weekly };
    }
    case "get_weekly_trend":
      return { as_of: asOf, campaign_id: input.campaign_id ?? null, weeks: await weeklyTrend(asOf, input.campaign_id ? String(input.campaign_id).toUpperCase() : null) };
    case "list_tasks": {
      const tasks = await listTasks({ status: input.status, campaign_id: input.campaign_id, owner: input.owner });
      return { as_of: asOf, tasks: tasks.map((t) => ({ ...t, overdue: t.status !== "done" && t.due_date && t.due_date < asOf })) };
    }
    case "run_sql": {
      const sql = String(input.sql || "").trim().replace(/;+\s*$/, "");
      if (!/^(select|with)\b/i.test(sql) || sql.includes(";")) return { error: "Only a single SELECT or WITH query is allowed." };
      if (/\b(insert|update|delete|drop|alter|create|grant|truncate|copy|pg_sleep|set_config)\b/i.test(sql)) return { error: "Write or admin statements are not allowed." };
      try {
        const rows = await readOnly(sql, 200);
        return { rows, row_count: rows.length, truncated: rows.length >= 200 };
      } catch (e: any) {
        return { error: `SQL error: ${e?.message ?? e}` };
      }
    }
    case "get_definitions":
      return { definitions: DEFINITIONS, data_quality: await dataQuality(asOf), assumptions: ASSUMPTIONS };
    case "simulate_plan": {
      const preset = input.preset === "stretch" ? "stretch" : "base";
      const o = { ...(input.overrides || {}) };
      const CH: Record<string, string> = { organic_search: "Organic Search", community_groups: "Community Groups", campus_ambassadors: "Campus Ambassadors", paid_social: "Paid Social", creator_partners: "Creator Partners" };
      const spend: Record<string, number> = {};
      for (const [k, v] of Object.entries(o.spendK || {})) { const ch = CH[k] ?? (Object.values(CH).includes(k) ? k : null); if (ch && Number.isFinite(Number(v))) spend[ch] = Number(v); }
      delete o.spendK;
      const p: PlanInputs = { ...PRESETS[preset], ...o, spendK: { ...PRESETS[preset].spendK, ...spend } };
      const r = runPlan(p);
      const round = (n: number) => Math.round(n);
      return { preset, inputs: p, projected_attendees: round(r.attendees), registrations: round(r.regs), spend_inr: round(r.spendK * 1000), reserve_inr: round(r.reserveK * 1000),
        cost_per_attendee: round(r.costPerAttendee), vs_2025: round(r.vs2025), capacity: r.capacity, over_budget: r.overBudget,
        by_channel: r.rows.map((x) => ({ channel: x.channel, spend_inr: round(x.spendK * 1000), registrations: round(x.regs), attendees: round(x.attendees), cost_per_attendee: x.costPerAttendee && round(x.costPerAttendee), vs_2025: round(x.vs2025), basis: x.basis })),
        note: "Planning model: 2025 unit economics from the source data plus labelled assumptions. Not a forecast from live data." };
    }
    case "propose_task": {
      if (!input.title) return { error: "title is required" };
      if (input.campaign_id && !(await q1(`SELECT 1 FROM campaigns WHERE id=$1`, [String(input.campaign_id).toUpperCase()]))) return { error: `Unknown campaign ${input.campaign_id}` };
      const p: Proposal = { id: `p${Date.now().toString(36)}${ctx.proposals.length}`, kind: "task", status: "pending", payload: { ...input, campaign_id: input.campaign_id ? String(input.campaign_id).toUpperCase() : null } };
      ctx.proposals.push(p);
      return { proposal_id: p.id, status: "awaiting_user_confirmation", note: "Shown to the user as a card. Not saved until they confirm." };
    }
    case "propose_campaign_change": {
      const id = String(input.campaign_id || "").toUpperCase();
      if (!(await q1(`SELECT 1 FROM campaigns WHERE id=$1`, [id]))) return { error: `Unknown campaign ${input.campaign_id}` };
      if (!input.changes || !Object.keys(input.changes).length) return { error: "changes is empty" };
      const p: Proposal = { id: `p${Date.now().toString(36)}${ctx.proposals.length}`, kind: "campaign_change", status: "pending", payload: { campaign_id: id, changes: input.changes, rationale: input.rationale } };
      ctx.proposals.push(p);
      return { proposal_id: p.id, status: "awaiting_user_confirmation" };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

export async function weeklyTrend(asOf: string, campaignId: string | null) {
  const c = cutoff(asOf);
  const params: unknown[] = [c, asOf];
  if (campaignId) params.push(campaignId);
  const cf = campaignId ? "AND campaign_id = $3" : "";
  const rows = await q<any>(`
    WITH regs AS (SELECT r.registration_id, r.campaign_id, r.registered_at FROM registrations r JOIN people p ON p.person_id=r.person_id AND p.person_type='external' WHERE r.registered_at <= $1),
    canc AS (SELECT h.effective_at, r.campaign_id FROM registration_history h JOIN regs r ON r.registration_id=h.registration_id WHERE h.status='cancelled' AND h.effective_at <= $1),
    att AS (SELECT DISTINCT ON (c.person_id) c.person_id, COALESCE(c.campaign_id,'WALKIN') campaign_id, c.occurred_at FROM checkins c JOIN people p ON p.person_id=c.person_id AND p.person_type='external'
            WHERE c.result='admitted' AND c.verification='verified' AND c.occurred_at <= $1 ORDER BY c.person_id, c.occurred_at),
    w AS (
      SELECT date_trunc('week', (registered_at AT TIME ZONE 'Asia/Kolkata'))::date wk, 'regs' k, 1 v FROM regs WHERE true ${cf}
      UNION ALL SELECT date_trunc('week', (effective_at AT TIME ZONE 'Asia/Kolkata'))::date, 'canc', 1 FROM canc WHERE true ${cf}
      UNION ALL SELECT date_trunc('week', (occurred_at AT TIME ZONE 'Asia/Kolkata'))::date, 'att', 1 FROM att WHERE true ${cf}
      UNION ALL SELECT date_trunc('week', activity_date)::date, 'spend', spend_inr FROM daily_marketing WHERE activity_date <= $2::date ${cf})
    SELECT wk::text week_start, sum(v) FILTER (WHERE k='regs')::int new_registrations, sum(v) FILTER (WHERE k='canc')::int cancellations,
      sum(v) FILTER (WHERE k='att')::int new_attendees, sum(v) FILTER (WHERE k='spend')::int spend_inr
    FROM w GROUP BY wk ORDER BY wk`, params);
  return rows.map((r) => ({ week_start: r.week_start, new_registrations: r.new_registrations ?? 0, cancellations: r.cancellations ?? 0, new_attendees: r.new_attendees ?? 0, spend_inr: r.spend_inr ?? 0 }));
}

export type ChatResult = { text: string; toolsUsed: { name: string; summary: string }[]; proposals: Proposal[]; error?: string };

// Gemini accepts an OpenAPI-style subset of JSON Schema: drop keywords it rejects.
function toGeminiSchema(s: any): any {
  if (!s || typeof s !== "object") return s;
  const { additionalProperties, ...rest } = s;
  void additionalProperties;
  if (rest.properties) rest.properties = Object.fromEntries(Object.entries(rest.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  if (rest.items) rest.items = toGeminiSchema(rest.items);
  return rest;
}

const functionDeclarations = tools.map((t) => {
  const params = toGeminiSchema(t.input_schema);
  const hasProps = params?.properties && Object.keys(params.properties).length > 0;
  return hasProps ? { name: t.name, description: t.description, parameters: params } : { name: t.name, description: t.description };
});

type Part = { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name: string; args?: any; id?: string }; functionResponse?: { name: string; response: any; id?: string } };
type Content = { role: "user" | "model"; parts: Part[] };

class GeminiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function callModel(model: string, contents: Content[], system: string, key: string) {
  const base = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
  const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: [{ functionDeclarations }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: { maxOutputTokens: 8192 },
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new GeminiError(res.status, body?.error?.message ?? `HTTP ${res.status}`);
  return body;
}

async function generate(contents: Content[], system: string, key: string) {
  const configured = process.env.GEMINI_MODEL?.trim();
  const order = [...new Set([workingModel, configured, ...DEFAULT_MODELS].filter(Boolean) as string[])];
  let lastErr: unknown;
  for (const model of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = await callModel(model, contents, system, key);
        workingModel = model;
        return body;
      } catch (e) {
        lastErr = e;
        const st = e instanceof GeminiError ? e.status : 0;
        // 404: model closed to this key. 429: free-tier quota is per model. 5xx: model overloaded.
        if (![404, 429, 500, 502, 503, 504].includes(st)) throw e;
        console.warn(`Gemini model ${model} returned ${st}: ${(e as Error).message}`);
        if (st >= 500 && attempt === 0) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        if (workingModel === model) workingModel = null;
        break;
      }
    }
  }
  throw lastErr;
}

export async function runAnalyst(sessionId: string, userText: string, asOf: string, displayUser = userText): Promise<ChatResult> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    return { text: "The AI analyst isn't configured yet: the server has no GEMINI_API_KEY. Add a free key from Google AI Studio to the environment and reload. Everything else in the app works without it.", toolsUsed: [], proposals: [], error: "no_key" };
  }
  const meta = await getMeta();
  await q(`INSERT INTO chat_sessions (id, title) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [sessionId, displayUser.slice(0, 80)]);
  const history = await q<any>(`SELECT role, content FROM chat_messages WHERE session_id=$1 AND role IN ('user','assistant') ORDER BY id`, [sessionId]);
  // Stored content is an array of Gemini parts. Skip anything in another shape.
  const contents: Content[] = history
    .filter((h) => Array.isArray(h.content) && h.content.length && h.content.every((p: any) => p && typeof p === "object" && !("type" in p)))
    .map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: h.content }));
  // History must start with a user turn that is plain text.
  while (contents.length && (contents[0].role !== "user" || contents[0].parts.some((p) => p.functionResponse))) contents.shift();
  const userMsg: Content = { role: "user", parts: [{ text: userText }] };
  contents.push(userMsg);
  const newContents: Content[] = [userMsg];
  const ctx = { asOf, proposals: [] as Proposal[] };
  const toolsUsed: ChatResult["toolsUsed"] = [];
  let finalText = "";
  const system = systemPrompt(asOf, meta);

  for (let step = 0; step < MAX_STEPS; step++) {
    let body: any;
    try {
      body = await generate(contents, system, key);
    } catch (e) {
      console.error(e);
      const st = e instanceof GeminiError ? e.status : 0;
      const msg = st === 429 ? "The free Gemini quota is used up for the moment. Wait a minute and try again."
        : st === 400 && /api key/i.test((e as Error).message) ? "The GEMINI_API_KEY on the server was rejected."
        : st === 401 || st === 403 ? "The GEMINI_API_KEY on the server was rejected or lacks access to this model."
        : st >= 500 ? "Gemini is overloaded right now on every model this app tries. Wait a minute and ask again."
        : st ? `The AI service returned an error (${st}).` : "Couldn't reach the AI service.";
      return { text: finalText ? `${finalText}\n\n(${msg})` : msg, toolsUsed, proposals: ctx.proposals, error: "api" };
    }
    const cand = body?.candidates?.[0];
    if (!cand?.content?.parts?.length) {
      const reason = body?.promptFeedback?.blockReason || cand?.finishReason;
      finalText = finalText || (reason === "SAFETY" || reason === "PROHIBITED_CONTENT" ? "I can't help with that request." : "The AI service returned an empty answer. Try rephrasing the question.");
      break;
    }
    const parts: Part[] = cand.content.parts;
    const modelMsg: Content = { role: "model", parts };
    contents.push(modelMsg); newContents.push(modelMsg);
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
    if (text) finalText = text;
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (!calls.length) break;
    const responses: Part[] = [];
    for (const c of calls) {
      let out: any;
      try { out = await execTool(c.name, c.args ?? {}, ctx); } catch (e: any) { out = { error: String(e?.message ?? e) }; }
      const s = JSON.stringify(out);
      const response = s.length > 60000 ? { truncated_json: s.slice(0, 60000) } : out && typeof out === "object" && !Array.isArray(out) ? out : { result: out };
      responses.push({ functionResponse: { name: c.name, response, ...(c.id ? { id: c.id } : {}) } });
      const a = c.args ?? {};
      toolsUsed.push({ name: c.name, summary: c.name === "run_sql" ? String(a.purpose ?? "query") : c.name === "get_campaign" ? String(a.campaign_id ?? "") : a.as_of ?? "" });
    }
    const respMsg: Content = { role: "user", parts: responses };
    contents.push(respMsg); newContents.push(respMsg);
    if (step === MAX_STEPS - 1) finalText = finalText || "I ran out of steps before finishing. Try a narrower question.";
  }

  // An unfinished tool loop must not leave dangling function responses at the end of history.
  const last = newContents[newContents.length - 1];
  if (last.role === "user" && last.parts.some((p) => p.functionResponse)) {
    newContents.push({ role: "model", parts: [{ text: finalText || "(stopped)" }] });
  }
  for (const m of newContents) {
    await q(`INSERT INTO chat_messages (session_id, role, content, display) VALUES ($1,$2,$3,$4)`, [sessionId, m.role === "model" ? "assistant" : "user", JSON.stringify(m.parts), null]);
  }
  const display = { role: "assistant_display", text: finalText, toolsUsed, proposals: ctx.proposals, asOf };
  await q(`INSERT INTO chat_messages (session_id, role, content, display) VALUES ($1,'display',$2,$3)`, [sessionId, JSON.stringify([]), JSON.stringify({ ...display, user: displayUser })]);
  return { text: finalText, toolsUsed, proposals: ctx.proposals };
}

export async function setProposalStatus(sessionId: string, proposalId: string, status: "confirmed" | "dismissed", resultNote: string) {
  const rows = await q<any>(`SELECT id, display FROM chat_messages WHERE session_id=$1 AND role='display' ORDER BY id DESC`, [sessionId]);
  for (const r of rows) {
    const d = r.display;
    const p = d?.proposals?.find((x: any) => x.id === proposalId);
    if (p) { p.status = status; p.result = resultNote; await q(`UPDATE chat_messages SET display=$2 WHERE id=$1`, [r.id, JSON.stringify(d)]); return p as Proposal; }
  }
  return null;
}

export async function chatTranscript(sessionId: string) {
  const rows = await q<any>(`SELECT display FROM chat_messages WHERE session_id=$1 AND role='display' ORDER BY id`, [sessionId]);
  return rows.map((r) => r.display);
}

void addDays;

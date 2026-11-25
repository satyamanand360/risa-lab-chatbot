import "server-only";
import { q, q1, logActivity } from "./db";

export class InputError extends Error {}

const STATUSES = ["todo", "in_progress", "done"];
const PRIORITIES = ["low", "medium", "high"];
const CAMPAIGN_STATUSES = ["active", "paused", "stopped"];
const REG_STATUSES = ["interested", "confirmed", "waitlisted", "cancelled"];

function str(v: unknown, name: string, { required = false, max = 500 } = {}) {
  if (v == null || v === "") { if (required) throw new InputError(`${name} is required`); return null; }
  if (typeof v !== "string") throw new InputError(`${name} must be text`);
  const s = v.trim();
  if (required && !s) throw new InputError(`${name} is required`);
  if (s.length > max) throw new InputError(`${name} is too long`);
  return s || null;
}
function int(v: unknown, name: string, { min = -1e9, max = 1e9, required = false } = {}) {
  if (v == null || v === "") { if (required) throw new InputError(`${name} is required`); return null; }
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new InputError(`${name} must be a whole number`);
  if (n < min || n > max) throw new InputError(`${name} must be between ${min} and ${max}`);
  return n;
}
function date(v: unknown, name: string, required = false) {
  if (v == null || v === "") { if (required) throw new InputError(`${name} is required`); return null; }
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw new InputError(`${name} must be a date (YYYY-MM-DD)`);
  return v;
}
function oneOf(v: unknown, list: string[], name: string, fallback?: string) {
  if (v == null || v === "") { if (fallback) return fallback; throw new InputError(`${name} is required`); }
  if (typeof v !== "string" || !list.includes(v)) throw new InputError(`${name} must be one of ${list.join(", ")}`);
  return v;
}
async function campaignExists(id: string | null) {
  if (!id) return null;
  const c = await q1(`SELECT id FROM campaigns WHERE id=$1`, [id]);
  if (!c) throw new InputError(`Unknown campaign ${id}`);
  return id;
}

export async function createTask(body: any, actor = "user") {
  const title = str(body.title, "Title", { required: true, max: 200 });
  const row = await q1<any>(`INSERT INTO tasks (title, description, campaign_id, owner_name, due_date, status, priority, created_by, rationale)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [
    title, str(body.description, "Description", { max: 2000 }), await campaignExists(str(body.campaign_id, "Campaign")),
    str(body.owner_name, "Owner", { max: 100 }), date(body.due_date, "Due date"), oneOf(body.status, STATUSES, "Status", "todo"),
    oneOf(body.priority, PRIORITIES, "Priority", "medium"), actor === "ai" ? "ai" : "user", str(body.rationale, "Rationale", { max: 2000 })]);
  await logActivity(actor, "create", "task", row.id, { title });
  return row.id as number;
}

export async function updateTask(id: number, body: any, actor = "user") {
  const existing = await q1<any>(`SELECT * FROM tasks WHERE id=$1`, [id]);
  if (!existing) throw new InputError("Task not found");
  const next = {
    title: body.title !== undefined ? str(body.title, "Title", { required: true, max: 200 }) : existing.title,
    description: body.description !== undefined ? str(body.description, "Description", { max: 2000 }) : existing.description,
    campaign_id: body.campaign_id !== undefined ? await campaignExists(str(body.campaign_id, "Campaign")) : existing.campaign_id,
    owner_name: body.owner_name !== undefined ? str(body.owner_name, "Owner", { max: 100 }) : existing.owner_name,
    due_date: body.due_date !== undefined ? date(body.due_date, "Due date") : existing.due_date,
    status: body.status !== undefined ? oneOf(body.status, STATUSES, "Status") : existing.status,
    priority: body.priority !== undefined ? oneOf(body.priority, PRIORITIES, "Priority") : existing.priority,
  };
  await q(`UPDATE tasks SET title=$2, description=$3, campaign_id=$4, owner_name=$5, due_date=$6, status=$7, priority=$8, updated_at=now() WHERE id=$1`,
    [id, next.title, next.description, next.campaign_id, next.owner_name, next.due_date, next.status, next.priority]);
  await logActivity(actor, "update", "task", id, body);
}

export async function deleteTask(id: number, actor = "user") {
  await q(`DELETE FROM tasks WHERE id=$1`, [id]);
  await logActivity(actor, "delete", "task", id);
}

export async function updateCampaign(id: string, body: any, actor = "user") {
  const c = await q1<any>(`SELECT * FROM campaigns WHERE id=$1`, [id]);
  if (!c) throw new InputError("Campaign not found");
  const next = {
    name: body.name !== undefined ? str(body.name, "Name", { required: true, max: 120 }) : c.name,
    owner_name: body.owner_name !== undefined ? str(body.owner_name, "Owner", { max: 100 }) : c.owner_name,
    status: body.status !== undefined ? oneOf(body.status, CAMPAIGN_STATUSES, "Status") : c.status,
    planned_budget_inr: body.planned_budget_inr !== undefined ? int(body.planned_budget_inr, "Planned budget", { min: 0, max: 1e8 }) : c.planned_budget_inr,
    attendee_target: body.attendee_target !== undefined ? int(body.attendee_target, "Attendee target", { min: 0, max: 1e6 }) : c.attendee_target,
    notes: body.notes !== undefined ? str(body.notes, "Notes", { max: 4000 }) : c.notes,
  };
  const planChanged = next.planned_budget_inr !== c.planned_budget_inr || next.attendee_target !== c.attendee_target;
  await q(`UPDATE campaigns SET name=$2, owner_name=$3, status=$4, planned_budget_inr=$5, attendee_target=$6, notes=$7, plan_source=$8, updated_at=now() WHERE id=$1`,
    [id, next.name, next.owner_name, next.status, next.planned_budget_inr, next.attendee_target, next.notes, planChanged ? "user" : c.plan_source]);
  await logActivity(actor, "update", "campaign", id, body);
}

export async function createCampaign(body: any, actor = "user") {
  const name = str(body.name, "Name", { required: true, max: 120 });
  const n = await q1<any>(`SELECT count(*)::int n FROM campaigns`);
  let id = `C${String(Number(n.n) + 1).padStart(2, "0")}`;
  while (await q1(`SELECT 1 FROM campaigns WHERE id=$1`, [id])) id = `C${String(Number(id.slice(1)) + 1).padStart(2, "0")}`;
  await q(`INSERT INTO campaigns (id, name, channel, audience, objective, owner_name, planned_start, planned_end, status, planned_budget_inr, attendee_target, source, plan_source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,'user','user')`, [
    id, name, str(body.channel, "Channel", { max: 60 }) ?? "other", str(body.audience, "Audience", { max: 300 }), str(body.objective, "Objective", { max: 300 }),
    str(body.owner_name, "Owner", { max: 100 }), date(body.planned_start, "Start date"), date(body.planned_end, "End date"),
    int(body.planned_budget_inr, "Planned budget", { min: 0, max: 1e8 }), int(body.attendee_target, "Attendee target", { min: 0, max: 1e6 })]);
  await logActivity(actor, "create", "campaign", id, { name });
  return id;
}

export async function addDaily(body: any, actor = "user") {
  const campaign_id = await campaignExists(str(body.campaign_id, "Campaign", { required: true }));
  const d = date(body.activity_date, "Date", true)!;
  const nums = {
    impressions: int(body.impressions, "Impressions", { min: 0 }) ?? 0, clicks: int(body.clicks, "Clicks", { min: 0 }) ?? 0,
    reported_reach: int(body.reported_reach, "Reach", { min: 0 }) ?? 0, sessions: int(body.sessions, "Sessions", { min: 0 }) ?? 0,
    registration_starts: int(body.registration_starts, "Registration starts", { min: 0 }) ?? 0, spend_inr: int(body.spend_inr, "Spend", { min: -1e7, max: 1e7 }) ?? 0,
  };
  const id = `AD-${campaign_id}-${d.replaceAll("-", "")}-U${Date.now().toString(36)}`;
  await q(`INSERT INTO daily_marketing (activity_id, campaign_id, activity_date, impressions, clicks, reported_reach, sessions, registration_starts, spend_inr, platform, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual entry','user')`, [id, campaign_id, d, nums.impressions, nums.clicks, nums.reported_reach, nums.sessions, nums.registration_starts, nums.spend_inr]);
  await logActivity(actor, "create", "daily_marketing", id, { campaign_id, date: d, ...nums });
  return id;
}

export async function deleteDaily(id: string, actor = "user") {
  const row = await q1<any>(`SELECT source FROM daily_marketing WHERE activity_id=$1`, [id]);
  if (!row) throw new InputError("Row not found");
  if (row.source !== "user") throw new InputError("Only rows entered in the app can be deleted. Source data is kept intact; add a negative spend row to correct it.");
  await q(`DELETE FROM daily_marketing WHERE activity_id=$1`, [id]);
  await logActivity(actor, "delete", "daily_marketing", id);
}

/** Records a new external registrant (person + registration + first status) at the given IST time. */
export async function addRegistration(body: any, actor = "user") {
  const name = str(body.person_name, "Name", { required: true, max: 120 });
  const campaign_id = await campaignExists(str(body.campaign_id, "Campaign", { required: true }));
  const d = date(body.date, "Date", true)!;
  const status = oneOf(body.status, REG_STATUSES, "Status", "confirmed");
  const ts = `${d}T12:00:00+05:30`;
  const stamp = Date.now().toString(36).toUpperCase();
  const pid = `EU${stamp}`, rid = `RU${stamp}`, hid = `RHU${stamp}`;
  await q(`INSERT INTO people (person_id, person_name, person_type, first_seen_at, first_touch_source, first_campaign_id, source) VALUES ($1,$2,'external',$3,'campaign',$4,'user')`, [pid, name, ts, campaign_id]);
  await q(`INSERT INTO registrations (registration_id, person_id, campaign_id, registered_at, source) VALUES ($1,$2,$3,$4,'user')`, [rid, pid, campaign_id, ts]);
  await q(`INSERT INTO registration_history (history_id, registration_id, effective_at, status, source) VALUES ($1,$2,$3,$4,'user')`, [hid, rid, ts, status]);
  await logActivity(actor, "create", "registration", rid, { name, campaign_id, date: d, status });
  return rid;
}

export async function setRegistrationStatus(body: any, actor = "user") {
  const rid = str(body.registration_id, "Registration", { required: true })!;
  const reg = await q1<any>(`SELECT registered_at FROM registrations WHERE registration_id=$1`, [rid]);
  if (!reg) throw new InputError("Registration not found");
  const d = date(body.date, "Date", true)!;
  const status = oneOf(body.status, REG_STATUSES, "Status");
  const hid = `RHU${Date.now().toString(36).toUpperCase()}`;
  await q(`INSERT INTO registration_history (history_id, registration_id, effective_at, status, source) VALUES ($1,$2,$3,$4,'user')`, [hid, rid, `${d}T18:00:00+05:30`, status]);
  await logActivity(actor, "create", "registration_status", rid, { status, date: d });
}

export async function addCheckin(body: any, actor = "user") {
  const pid = str(body.person_id, "Person", { required: true })!;
  const person = await q1<any>(`SELECT person_id FROM people WHERE person_id=$1`, [pid]);
  if (!person) throw new InputError("Person not found");
  const reg = await q1<any>(`SELECT registration_id, campaign_id FROM registrations WHERE person_id=$1 ORDER BY registered_at DESC LIMIT 1`, [pid]);
  const d = date(body.date, "Date", true)!;
  const id = `CHKU${Date.now().toString(36).toUpperCase()}`;
  await q(`INSERT INTO checkins (event_id, person_id, registration_id, campaign_id, occurred_at, result, verification, source, origin) VALUES ($1,$2,$3,$4,$5,'admitted','verified','manual','user')`,
    [id, pid, reg?.registration_id ?? null, reg?.campaign_id ?? null, `${d}T11:00:00+05:30`]);
  await logActivity(actor, "create", "checkin", id, { person_id: pid, date: d });
  return id;
}

import "server-only";
import fs from "node:fs";
import path from "node:path";

type Row = Record<string, any>;
type Executor = {
  query: (sql: string, params?: unknown[]) => Promise<Row[]>;
  exec: (sql: string) => Promise<void>;
  readOnly: (sql: string) => Promise<Row[]>;
};

let executorPromise: Promise<Executor> | null = null;
let readyPromise: Promise<void> | null = null;

async function makeExecutor(): Promise<Executor> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool, types } = await import("pg");
    // Return BIGINT/NUMERIC as JS numbers; values here are small.
    types.setTypeParser(20, (v: string) => Number(v));
    types.setTypeParser(1700, (v: string) => Number(v));
    types.setTypeParser(1082, (v: string) => v); // DATE stays 'YYYY-MM-DD'
    const pool = new Pool({ connectionString: url, max: 5, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false } });
    return {
      query: async (sql, params = []) => (await pool.query(sql, params as any[])).rows,
      exec: async (sql) => { await pool.query(sql); },
      readOnly: async (sql) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN TRANSACTION READ ONLY");
          await client.query("SET LOCAL statement_timeout = 5000");
          return (await client.query(sql)).rows;
        } finally {
          await client.query("ROLLBACK").catch(() => {});
          client.release();
        }
      },
    };
  }
  const { PGlite, types } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR || (process.env.VERCEL ? "memory://" : path.join(process.cwd(), ".data", "pglite"));
  if (!dir.startsWith("memory://")) fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir, {
    parsers: {
      [types.INT8]: (v: string) => Number(v),
      [types.NUMERIC]: (v: string) => Number(v),
      [types.DATE]: (v: string) => v,
    },
  });
  return {
    query: async (sql, params = []) => (await db.query(sql, params as any[])).rows as Row[],
    exec: async (sql) => { await db.exec(sql); },
    readOnly: async (sql) => {
      let rows: Row[] = [];
      const ROLLBACK = new Error("rollback");
      try {
        await db.transaction(async (tx) => {
          await tx.exec("SET TRANSACTION READ ONLY");
          rows = (await tx.query(sql)).rows as Row[];
          throw ROLLBACK;
        });
      } catch (e) {
        if (e !== ROLLBACK) throw e;
      }
      return rows;
    },
  };
}

async function executor() {
  if (!executorPromise) executorPromise = makeExecutor();
  return executorPromise;
}

export async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureReady();
  const ex = await executor();
  return (await ex.query(sql, params)) as T[];
}

export async function q1<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

/** Runs a read-only query inside a transaction that is always rolled back. */
export async function readOnly(sql: string, limit = 200): Promise<Row[]> {
  await ensureReady();
  const ex = await executor();
  return ex.readOnly(`SELECT * FROM (${sql}) AS sub LIMIT ${Math.max(1, Math.min(limit, 500))}`);
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS event (id INT PRIMARY KEY DEFAULT 1, name TEXT, history_start DATE, history_end DATE, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS targets (id SERIAL PRIMARY KEY, effective_at TIMESTAMPTZ NOT NULL, version TEXT, people_goal INT, registration_goal INT, visitor_goal INT, budget_inr INT);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, channel TEXT, audience TEXT, objective TEXT, owner_id TEXT, owner_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), planned_start TIMESTAMPTZ, planned_end TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active', planned_budget_inr INT, attendee_target INT, notes TEXT,
  source TEXT NOT NULL DEFAULT 'dataset', plan_source TEXT, updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS daily_marketing (
  activity_id TEXT PRIMARY KEY, campaign_id TEXT REFERENCES campaigns(id), activity_date DATE NOT NULL,
  impressions INT DEFAULT 0, clicks INT DEFAULT 0, reported_reach INT DEFAULT 0, sessions INT DEFAULT 0,
  registration_starts INT DEFAULT 0, spend_inr INT DEFAULT 0, platform TEXT, source TEXT NOT NULL DEFAULT 'dataset', created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS people (person_id TEXT PRIMARY KEY, person_name TEXT, person_type TEXT, first_seen_at TIMESTAMPTZ, first_touch_source TEXT, first_campaign_id TEXT, source TEXT NOT NULL DEFAULT 'dataset');
CREATE TABLE IF NOT EXISTS interactions (interaction_id TEXT PRIMARY KEY, person_id TEXT, campaign_id TEXT, occurred_at TIMESTAMPTZ, event_type TEXT);
CREATE TABLE IF NOT EXISTS registrations (registration_id TEXT PRIMARY KEY, person_id TEXT, campaign_id TEXT, registered_at TIMESTAMPTZ, source TEXT NOT NULL DEFAULT 'dataset');
CREATE TABLE IF NOT EXISTS registration_history (history_id TEXT PRIMARY KEY, registration_id TEXT, effective_at TIMESTAMPTZ, status TEXT, source TEXT NOT NULL DEFAULT 'dataset');
CREATE TABLE IF NOT EXISTS checkins (event_id TEXT PRIMARY KEY, person_id TEXT, registration_id TEXT, campaign_id TEXT, occurred_at TIMESTAMPTZ, result TEXT, verification TEXT, source TEXT, origin TEXT NOT NULL DEFAULT 'dataset');
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT, campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  owner_name TEXT, due_date DATE, status TEXT NOT NULL DEFAULT 'todo', priority TEXT NOT NULL DEFAULT 'medium',
  created_by TEXT NOT NULL DEFAULT 'user', rationale TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS activity_log (id SERIAL PRIMARY KEY, at TIMESTAMPTZ DEFAULT now(), actor TEXT, action TEXT, entity TEXT, entity_id TEXT, detail JSONB);
CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), title TEXT);
CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE, role TEXT, content JSONB, display JSONB, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS data_quality (name TEXT PRIMARY KEY, rows_in_source INT, exact_duplicates_removed INT, rows_kept INT);
CREATE INDEX IF NOT EXISTS idx_hist_reg ON registration_history(registration_id, effective_at);
CREATE INDEX IF NOT EXISTS idx_chk_person ON checkins(person_id);
CREATE INDEX IF NOT EXISTS idx_daily_c ON daily_marketing(campaign_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_inter ON interactions(person_id);
`;

const DROP = `DROP TABLE IF EXISTS chat_messages, chat_sessions, activity_log, tasks, checkins, registration_history, registrations, interactions, people, daily_marketing, campaigns, targets, event, data_quality CASCADE;`;

/** Planning inputs the source data does not contain. Marked plan_source = 'simulated' everywhere they show. */
const SIMULATED_PLAN: Record<string, { budget: number; target: number }> = {
  C01: { budget: 45000, target: 420 }, C02: { budget: 90000, target: 450 }, C03: { budget: 60000, target: 250 },
  C04: { budget: 35000, target: 380 }, C05: { budget: 25000, target: 280 }, C06: { budget: 15000, target: 200 }, C07: { budget: 20000, target: 170 },
};

const SEED_TASKS = [
  { title: "Brief college club leads on group registration links", campaign_id: "C04", owner_name: "Meera Iyer", due_date: "2025-02-10", status: "done", priority: "high" },
  { title: "Refresh paid social creatives after week-2 review", campaign_id: "C02", owner_name: "Arjun Verma", due_date: "2025-02-20", status: "done", priority: "medium" },
  { title: "Send reminder sequence to confirmed registrants", campaign_id: null, owner_name: "Nisha Rao", due_date: "2025-04-09", status: "todo", priority: "high" },
  { title: "Recruit 10 more campus ambassadors in north Bengaluru colleges", campaign_id: "C01", owner_name: "Meera Iyer", due_date: "2025-03-05", status: "in_progress", priority: "medium" },
  { title: "Audit creator partner contracts for post-event spend", campaign_id: "C03", owner_name: "Nisha Rao", due_date: "2025-04-18", status: "todo", priority: "low" },
];

async function seedInto(ex: Executor) {
  const file = path.join(process.cwd(), "seed", "attendee_seed.json");
  const seed = JSON.parse(fs.readFileSync(file, "utf8"));
  const insert = async (table: string, cols: string[], rows: Row[]) => {
    const chunk = 500;
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows.slice(i, i + chunk);
      const params: unknown[] = [];
      const values = part.map((r) => "(" + cols.map((c) => { params.push(r[c] ?? null); return `$${params.length}`; }).join(",") + ")");
      await ex.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${values.join(",")}`, params);
    }
  };
  const e = seed.event;
  await ex.query(`INSERT INTO event (id,name,history_start,history_end,starts_at,ends_at) VALUES (1,$1,$2,$3,$4,$5)`, [e.name, e.history_start, e.history_end, e.starts_at, e.ends_at]);
  await insert("targets", ["effective_at", "version", "people_goal", "registration_goal", "visitor_goal", "budget_inr"], seed.targets);
  await insert("campaigns", ["id", "name", "channel", "audience", "objective", "owner_id", "owner_name", "created_at", "planned_start", "planned_end", "planned_budget_inr", "attendee_target", "plan_source"],
    seed.campaigns.map((c: Row) => ({ ...c, planned_budget_inr: SIMULATED_PLAN[c.id]?.budget, attendee_target: SIMULATED_PLAN[c.id]?.target, plan_source: "simulated" })));
  await insert("daily_marketing", ["activity_id", "campaign_id", "activity_date", "impressions", "clicks", "reported_reach", "sessions", "registration_starts", "spend_inr", "platform"], seed.daily);
  await insert("people", ["person_id", "person_name", "person_type", "first_seen_at", "first_touch_source", "first_campaign_id"], seed.people);
  await insert("interactions", ["interaction_id", "person_id", "campaign_id", "occurred_at", "event_type"], seed.interactions);
  await insert("registrations", ["registration_id", "person_id", "campaign_id", "registered_at"], seed.registrations);
  await insert("registration_history", ["history_id", "registration_id", "effective_at", "status"], seed.history);
  await insert("checkins", ["event_id", "person_id", "registration_id", "campaign_id", "occurred_at", "result", "verification", "source"], seed.checkins);
  await insert("data_quality", ["name", "rows_in_source", "exact_duplicates_removed", "rows_kept"], Object.entries(seed.quality).map(([name, v]: [string, any]) => ({ name, ...v })));
  await insert("tasks", ["title", "campaign_id", "owner_name", "due_date", "status", "priority"], SEED_TASKS);
}

async function init() {
  const ex = await executor();
  await ex.exec(SCHEMA);
  const has = await ex.query(`SELECT count(*)::int AS n FROM event`);
  if (!has[0] || Number(has[0].n) === 0) await seedInto(ex);
}

export function ensureReady() {
  if (!readyPromise) readyPromise = init().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}

/** Drops every table and reloads the original dataset plus the simulated plan. */
export async function resetDatabase() {
  const ex = await executor();
  await ex.exec(DROP);
  await ex.exec(SCHEMA);
  await seedInto(ex);
  readyPromise = Promise.resolve();
}

export async function logActivity(actor: string, action: string, entity: string, entityId: string | number | null, detail: Row = {}) {
  await q(`INSERT INTO activity_log (actor, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)`, [actor, action, entity, entityId == null ? null : String(entityId), JSON.stringify(detail)]);
}

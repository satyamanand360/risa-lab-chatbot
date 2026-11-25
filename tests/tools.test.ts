// Run: npx tsx --conditions=react-server tests/tools.test.ts  (uses a throwaway embedded database)
process.env.PGLITE_DIR = "memory://";
import assert from "node:assert/strict";
import http from "node:http";
import { execTool, runAnalyst } from "../src/lib/agent";
import { overview } from "../src/lib/metrics";
import { addDaily, addRegistration, addCheckin, createTask } from "../src/lib/mutations";

const ctx = { asOf: "2025-04-20", proposals: [] as any[] };
const run = (n: string, i: any = {}) => execTool(n, i, ctx) as Promise<any>;

(async () => {
  // Headline numbers after cleaning (match the README / deck)
  const ov = await run("get_overview");
  assert.equal(ov.totals.people, 3625); assert.equal(ov.totals.registrations, 2800); assert.equal(ov.totals.confirmed, 2500);
  assert.equal(ov.totals.attendees, 2050); assert.equal(ov.totals.walk_ins, 125); assert.equal(ov.totals.spend, 274000);
  assert.equal(ov.goal_in_force.attendees, 2200);
  // No future leakage: before the target change the launch plan applies and nobody has attended
  const early = await run("get_overview", { as_of: "2025-03-14" });
  assert.equal(early.goal_in_force.attendees, 1800); assert.equal(early.totals.attendees, 0);
  const cmp = await run("compare_campaigns");
  const c02 = cmp.campaigns.find((c: any) => c.campaign_id === "C02");
  assert.equal(c02.cost_per_attendee, 274); assert.equal(c02.recommendation.action, "fix");
  assert.equal(cmp.campaigns.find((c: any) => c.campaign_id === "C03").recommendation.action, "stop");
  const camp = await run("get_campaign", { campaign_id: "c04" });
  assert.equal(camp.stats.attendees, 385);
  const bad = await run("get_campaign", { campaign_id: "C99" }); assert.ok(bad.error);
  const wk = await run("get_weekly_trend"); assert.ok(wk.weeks.length > 10);
  const sql = await run("run_sql", { sql: "SELECT count(*)::int n FROM people WHERE person_type='external'", purpose: "test" });
  assert.equal(sql.rows[0].n, 3625);
  const write = await run("run_sql", { sql: "DELETE FROM tasks", purpose: "should fail" }); assert.ok(write.error);
  const sneaky = await run("run_sql", { sql: "WITH x AS (DELETE FROM tasks RETURNING 1) SELECT * FROM x", purpose: "should fail" }); assert.ok(sneaky.error);
  const defs = await run("get_definitions"); assert.ok(defs.definitions.not_available);
  const plan = await run("simulate_plan", { preset: "base" }); assert.equal(plan.projected_attendees, 2501);
  const stretch = await run("simulate_plan", { preset: "stretch" }); assert.equal(stretch.projected_attendees, 3743);
  const noPaid = await run("simulate_plan", { preset: "base", overrides: { spendK: { paid_social: 0 } } });
  assert.equal(noPaid.by_channel.find((c: any) => c.channel === "Paid Social").spend_inr, 0); assert.ok(noPaid.projected_attendees < 2501);
  const prop = await run("propose_task", { title: "Test", rationale: "r", campaign_id: "C04" });
  assert.equal(prop.status, "awaiting_user_confirmation"); assert.equal(ctx.proposals.length, 1);
  const tasksBefore = (await run("list_tasks")).tasks.length; assert.equal(tasksBefore, 5); // proposal did not write

  // Changing data changes analytics
  await addDaily({ campaign_id: "C02", activity_date: "2025-04-20", spend_inr: 10000 });
  const ov2 = await overview("2025-04-20"); assert.equal(ov2.totals.spend, 284000);
  const ov3 = await overview("2025-04-19"); assert.equal(ov3.totals.spend < 284000, true);
  await addRegistration({ person_name: "Test Person", campaign_id: "C04", date: "2025-04-01", status: "confirmed" });
  const ov4 = await overview("2025-04-20"); assert.equal(ov4.totals.registrations, 2801); assert.equal(ov4.totals.confirmed, 2501);
  const pid = (await run("run_sql", { sql: "SELECT person_id FROM people WHERE person_name='Test Person'", purpose: "t" })).rows[0].person_id;
  await addCheckin({ person_id: pid, date: "2025-04-12" });
  const ov5 = await overview("2025-04-20"); assert.equal(ov5.totals.attendees, 2051);
  await createTask({ title: "Real task", campaign_id: "C01" });
  assert.equal((await run("list_tasks")).tasks.length, 6);
  // Gemini tool loop against a local mock of generateContent: one tool call, then a final answer
  const seen: any[] = [];
  const server = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      const body = JSON.parse(b);
      if (req.url!.includes("gemini-3.6-flash")) { res.statusCode = 503; res.end(JSON.stringify({ error: { message: "overloaded" } })); return; }
      if (req.url!.includes("gemini-3.8-flash")) { res.statusCode = 404; res.end(JSON.stringify({ error: { message: "not found" } })); return; }
      seen.push({ url: req.url, key: req.headers["x-goog-api-key"], body });
      const last = body.contents[body.contents.length - 1];
      const reply = last.parts[0].functionResponse
        ? { candidates: [{ content: { role: "model", parts: [{ text: `Attendees: ${last.parts[0].functionResponse.response.totals.attendees}` }] }, finishReason: "STOP" }] }
        : { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "get_overview", args: {} }, thoughtSignature: "sig1" }] }, finishReason: "STOP" }] };
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.GEMINI_API_BASE = `http://127.0.0.1:${(server.address() as any).port}/v1beta`;
  process.env.GEMINI_API_KEY = "test-key";
  const chat = await runAnalyst("test-session", "How many attendees?", "2025-04-20");
  assert.equal(chat.text, "Attendees: 2051"); assert.equal(chat.toolsUsed[0].name, "get_overview");
  assert.equal(seen.length, 2); assert.equal(seen[0].key, "test-key"); assert.match(seen[0].url, /gemini-3\.5-flash-lite:generateContent$/); // skips the overloaded (503) model and the 404 one
  assert.ok(seen[0].body.tools[0].functionDeclarations.every((f: any) => !JSON.stringify(f).includes("additionalProperties")));
  assert.equal(seen[1].body.contents[1].parts[0].thoughtSignature, "sig1"); // thought signature sent back unchanged
  const chat2 = await runAnalyst("test-session", "And now?", "2025-04-20");
  assert.equal(seen[2].body.contents.length, 5); // follow-up carries the earlier turn's history
  assert.equal(chat2.text, "Attendees: 2051");
  server.close();
  console.log("All tool and data-change checks passed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

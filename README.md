# Growth Center: attendee growth for a Bengaluru college festival (Satyam Anand 22IE35003)

RISA Labs Growth APM assignment by **Satyam Anand (22IE35003)**. **Challenge A (attendee growth)**, city **Bengaluru**.

The submission has three parts:

1. **Strategy deck (3 slides, PDF).** In [`docs/Satyam_Anand_RISA_Growth_APM_Part1.pdf`](docs/Satyam_Anand_RISA_Growth_APM_Part1.pdf), with the funnel model script in [`docs/funnel_model.py`](docs/funnel_model.py). The target and the model, five ranked bets, and the signals and thresholds for each bet.
2. **Growth Center (this repo).** A working dashboard, campaign and task manager, and an embedded AI growth analyst, all running on the provided attendee dataset.
3. **This README.** Research, assumptions, calculations, sources, the prioritisation framework, setup, tools and known limitations.

---

## 1. What the product does

| Need from the brief | Where it lives |
|---|---|
| Measure: full funnel, campaign KPIs, targets vs actuals, conversion, budget, projected outcome | **Overview**: KPI tiles against the goal in force, a cumulative trend with the goal pace line, a funnel that keeps platform counts separate from people, a projection, and a campaign scorecard |
| Diagnose: winners, laggards, bottlenecks, what drove a change | Scorecard calls (**Scale / Hold / Change / Stop**, each with reasons), a **bottleneck** list (steps more than 15% below the blended rate), **last 7 vs prior 7 days** drivers, and a per-campaign deep dive |
| Decide: prioritise, allocate, scale/change/stop | Rule-based calls based on the slide 3 thresholds, editable simulated budgets and targets, and a **Plan 2026** scenario model |
| Execute: campaigns, tasks, owners, deadlines, with changes updating analytics | Campaign edits (status, budget, target, owner, notes), new campaigns, a **task board** with overdue flags, **Log results** (registrations, status changes, check-ins), daily spend and traffic entry, an activity log, and a demo reset |
| AI analyst | A chat panel on every page. It answers with tool calls against the live database, keeps follow-up context, proposes tasks and campaign changes that you confirm on a card, and says when the data can't answer |

### The as-of date (the key design choice)

Every number is computed **as it stood at the end of the selected day (IST)**. A registration's status is its latest history version on or before that date, so later records never leak into earlier dates. The goal and budget shown are the plan in force on that date (the launch plan until 15 Mar 2025, then the revised plan). Moving the date replays the campaign, so you can see what the team knew at each point. The AI analyst uses the same date.

### The insight-to-action workflow (demo script)

1. On **Overview**, set the date to **20 Mar**. The projection shows a gap of about 480 attendees against the revised 2,200 goal.
2. Ask the analyst: *"Are we on track for the attendee goal? What's the gap and why?"* It calls `get_overview` and `compare_campaigns` and explains the gap with figures.
3. Follow up: *"Which campaigns should we scale or stop?"* It ranks them by cost per confirmed registration and cancellation rate and cites the thresholds.
4. Follow up: *"Turn the top action into a task for the owner, due next Friday."* A **proposed task** card appears. Nothing is saved yet.
5. Click **Create task**. The task appears on the **Tasks** board, tagged *created from AI suggestion*, and the scorecard's open-task count updates.
6. Change data, for example log ₹20,000 of spend for Paid Social on the campaign page. The cost per confirmed registration, the call and the analyst's next answer all change.
7. Ask something the data can't support: *"Which colleges are sending the most attendees?"* The analyst explains that the data has no college field and offers the closest supported answer (by campaign).

---

## 2. Data handling (sourced facts)

Source: `RISA LABS/Attendee Dataset.xlsx` (fictional event **CampusFest 2025**, 12–13 Apr 2025, records 15 Jan–20 Apr 2025, IST, INR). `scripts/export_seed.py` converts it to `seed/attendee_seed.json`. Only exact duplicate IDs are removed at export. All other rules run at query time, so the raw facts stay intact.

| Trap in the data | How it's handled |
|---|---|
| Exact duplicate IDs after import retries | Removed: 2 daily marketing rows, 4 registration-history rows, 20 check-ins |
| Versioned registration history | Status = latest version with `effective_at ≤ end of selected day IST` |
| Goals and budget change on 15 Mar | The plan in force on the selected date is used. Launch plan: 3,200 people / 2,800 registrations / 1,800 attendees / ₹2.4L. Revised plan: 3,600 / 3,200 / 2,200 / ₹3.0L |
| Who counts as an attendee | A distinct **external** person with an **admitted and verified** check-in. Repeat admissions count once. 125 walk-ins count. 40 internal, 10 staff and 10 test people are excluded |
| Reach and impressions aren't people | Shown separately as "platform counts". The people funnel starts at identified people |
| Negative spend rows | Treated as credits, net on their posting date (4 rows) |
| Attribution | Observational, by the campaign recorded on the registration or check-in. The app says "associated with", not "caused" |

**Headline end-state (20 Apr 2025):** 3,625 external people, 2,800 registrations (2,500 confirmed, 183 cancelled, 88 waitlisted, 29 interested), **2,050 verified attendees** (1,925 registered + 125 walk-ins) against a goal of 2,200, and ₹2.74L net spend, which is **₹134 per attendee**.

| Campaign | Spend | Regs | Attendees | ₹ / attendee | Attended / confirmed |
|---|---:|---:|---:|---:|---:|
| College Partnerships | ₹31k | 450 | 385 | ₹81 | 92% |
| Student Referrals | ₹19k | 350 | 275 | ₹69 | 86% |
| Organic Search | ₹14k | 250 | 195 | ₹72 | 87% |
| Community Groups | ₹16k | 200 | 165 | ₹97 | 89% |
| Campus Ambassadors | ₹42k | 520 | 390 | ₹108 | 81% |
| Paid Social | ₹93k | 680 | 340 | ₹274 | 59% |
| Creator Partners | ₹59k | 350 | 175 | ₹337 | 60% |

### Simulated data (clearly labelled in the app)

The source has no per-campaign budgets or attendee targets, so the app seeds **simulated** ones. They are tagged *simulated* everywhere and can be edited: C01 ₹45k / 420, C02 ₹90k / 450, C03 ₹60k / 250, C04 ₹35k / 380, C05 ₹25k / 280, C06 ₹15k / 200, C07 ₹20k / 170, which sums to ₹2.9L and 2,150 targeted attendees plus walk-ins. Five seed tasks are also simulated.

---

## 3. Strategy and calculations

### Why Bengaluru
Bengaluru Urban has **1,058+ colleges, the most of any district in India** (AISHE, reported by [Deccan Herald](https://deccanherald.com/india/bangalore-urban-district-tops-list-with-highest-number-of-colleges-1186213.html)). Karnataka has 62 colleges per lakh population. The city also has dense engineering and design campuses, a strong club culture, and many tech and startup brands that want student audiences. Group channels, the strongest in the data, need exactly that kind of density.

### Model (slide 1, and the Plan 2026 page)
- **Starting point (sourced):** 2025 channel unit economics from the table above. The 2025 rates come from the dataset's event, which is not set in Bengaluru; this is the biggest caveat.
- **College partnerships, bottom-up:** colleges pitched × sign rate × registrations per college × 86% show. Base 150 × 30% × 22. Stretch 200 × 35% × 25.
- **Scaled or cut channels:** attendees = 2025 attendees × (new spend / 2025 spend)^e, with e = 0.85 for ambassadors, community and organic, and 0.6 for paid and creators. These diminishing-returns elasticities are assumptions.
- **Referrals:** referred registrations per 100 other registrations. Sourced 2025 rate: 14. Assumed: 18 (base), 28 (stretch). The reward is paid only on the friend's verified check-in.
- **Show-up engine:** confirmed → attended rises from 76% (model baseline; 2025 actual 77%) to 80% (base) or 85% (stretch), capped at 92% of registrations per channel.
- **Capacity check:** 3,000 gate entries per day (assumption). In 2025, 70% of first visits came on Day 1 (sourced: 1,430 of 2,050).

| | 2025 actual | Base | Stretch |
|---|---:|---:|---:|
| Registrations | 2,800 | 2,924 | 3,941 |
| Confirmed | 2,500 | 2,611 | 3,519 |
| Registered attendees | 1,925 | 2,376 | 3,443 |
| Walk-ins | 125 | 125 | 300 |
| **Verified attendees** | **2,050** | **2,501** | **3,743** |
| Spend | ₹2.74L | ₹2.67L + ₹33k reserve | ₹2.95L |
| ₹ per attendee | ₹134 | ₹107 | ₹79 |

Downside check: if only 20% of colleges sign, the base drops to about 2,150, which is still above 2025.

### Prioritisation framework (slide 2)
Each bet is scored on **incremental verified attendees × confidence ÷ cost**. Confidence reflects how much of the estimate rests on 2025 evidence rather than assumption. Marginal cost per extra attendee in the base case: college partnerships ₹111, show-up engine ₹160, ambassadors and communities ₹125, referrals ₹301 in base but ₹121 in stretch.

1. College club group passes: +466 base / +1,120 stretch, ₹82.5k. **Double down.**
2. Show-up and day-of engine: +125 / +477, ₹20k. **Double down.**
3. Give-get referrals: +77 / +406, ₹44k. **Double down.**
4. Ambassadors and communities, in non-partner colleges only: +96 / +58, ₹70k. **Keep and prune.**
5. Paid social, retargeting only: −151 / −205, but it frees ₹58k. **Shrink and test.**

Rejected: Creator Partners (₹337 per attendee, 50% show; −175 attendees, frees ₹59k) and buying reach. Net base: 2,050 + 466 + 125 + 77 + 96 − 151 − 175 + 12 (organic) = **2,500**.

### Thresholds (slide 3), as used by the app
The scorecard applies these rules against the blended rate on the selected date. Before the event it compares cost per confirmed registration; after the event, cost per verified attendee.
- **Stop**: cost at least 2× blended, or show rate below 55%.
- **Change**: cost at least 1.3× blended, cancellation rate at least 1.5× blended, or show rate below 65%.
- **Scale**: cost at most 0.8× blended, cancellations no worse than blended + 2 points, and show rate at least 75%.
- **Hold**: everything else, or fewer than 15 registrations.

**Projection before the event:** registrations at the last-14-day run-rate up to event day × the current confirmed share × an assumed 75% show rate + 100 walk-ins. Both numbers are labelled as assumptions. Actual check-ins replace the projection once the event starts.

---

## 4. The AI growth analyst

- **Model:** Google Gemini on the free tier, called through the Gemini REST API (`generateContent` with function calling) in a manual tool loop of up to 10 steps. It uses `GEMINI_MODEL` if set, then tries `gemini-3.5-flash-lite` (fastest on the free tier in testing), `gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-flash-latest` and `gemini-2.5-flash` in order. A model that is closed to the key, out of free quota, overloaded or silent for 30 seconds is skipped, and the first that answers is remembered. The chat shows which model answered. Thought signatures are sent back unchanged, so newer Gemini models keep their reasoning across tool calls.
- **Tools** (`src/lib/agent.ts`): `get_overview`, `compare_campaigns`, `get_campaign`, `get_weekly_trend`, `list_tasks`, `run_sql` (read-only), `get_definitions`, `simulate_plan`, `propose_task` and `propose_campaign_change`.
- **Grounding:** the system prompt tells it to answer only from tool results, to show its working, to label assumptions, and to say what's missing when the data can't answer. `get_definitions` lists what the data doesn't contain: demographics, college names, prices or revenue, and similar.
- **Safety:** `run_sql` runs inside a read-only transaction that is always rolled back, with a keyword guard and a 200-row cap. Proposals are never written by the model; only the user's click on the card saves them. There's also a per-IP hourly limit.
- **Follow-ups:** the full conversation, including tool calls, is stored per session in the database and replayed on each turn. Confirmed or dismissed proposals are passed back as a note on the next turn.

---

## 5. Setup

```bash
npm install
cp .env.example .env.local     # add GEMINI_API_KEY (free from Google AI Studio)
npm run dev                    # http://localhost:3000
npm test                       # data and tool checks on a throwaway database
```

- **Database:** without `DATABASE_URL`, the app uses an embedded Postgres (PGlite) in `.data/`, seeded on first start. For a hosted deployment, set `DATABASE_URL` to any Postgres (Neon, Supabase, Vercel Postgres); the schema and seed load automatically. **Log results → Reset demo data** restores the original dataset.
- **Deploy (Vercel):** import the repo, add `GEMINI_API_KEY` and `DATABASE_URL`, and deploy. Without `DATABASE_URL` on Vercel the database lives in memory and resets when the server restarts.
- **Regenerate the seed:** `python3 scripts/export_seed.py "<path>/Attendee Dataset.xlsx" seed/attendee_seed.json`

## 6. Testing

`npm test` (`tests/tools.test.ts`) checks the following:
- the headline numbers after cleaning;
- no future leakage (the 14 Mar date uses the launch plan and shows 0 attendees);
- the campaign calls for C02 (Change) and C03 (Stop);
- every analyst tool, including that `run_sql` rejects writes, including a write hidden in a CTE;
- the plan presets reproduce 2,501 and 3,743;
- a proposal doesn't write anything;
- logging spend, a registration and a check-in each changes the analytics on the right dates.

The UI was checked page by page in a headless browser. The chatbot's live answers need an API key, so they are tested on the deployed app.

## 7. Tools used

Next.js 15, React 19, TypeScript, Recharts, PostgreSQL (`pg`) or PGlite, the Google Gemini API (free tier), Python and pandas for the export, and Playwright for screenshots. The deck was built with Claude's Slides artifact. The code, analysis and deck were written with Claude (Claude Code), then reviewed and verified with the checks above. The colour palette follows a colour-blind-validated categorical order.

## 8. Known limitations

- The 2025 conversion rates come from a synthetic event in an unnamed city. Bengaluru audience sizes beyond the AISHE college count are assumptions.
- Attribution is single-touch and observational. There are no holdout tests in the data.
- Per-campaign budgets and targets are simulated.
- The pre-event projection uses an assumed show rate. The run-rate method ignores late-registration surges, which the 2025 data shows in the final two weeks.
- There is no authentication: anyone with the link can edit data. Use **Reset demo data** to restore it.
- Without a hosted database, the Vercel deployment resets on cold starts.
- The chatbot depends on the Gemini API being available. The free tier has low per-minute and per-day request limits, and one question can take 2 to 5 model calls because of tool use, so heavy testing can hit the quota for a minute. The app also limits chat requests per IP.

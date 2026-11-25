/**
 * The 2026 Bengaluru planning model from the strategy deck (slide 1).
 * 2025 channel results come from the source data (spend in ₹k, registrations, verified attendees).
 * Everything in PlanInputs is an assumption the user can change.
 */
export const BASELINE_2025: Record<string, { spend: number; regs: number; attendees: number }> = {
  "College Partnerships": { spend: 31, regs: 450, attendees: 385 },
  "Student Referrals": { spend: 19, regs: 350, attendees: 275 },
  "Organic Search": { spend: 14, regs: 250, attendees: 195 },
  "Community Groups": { spend: 16, regs: 200, attendees: 165 },
  "Campus Ambassadors": { spend: 42, regs: 520, attendees: 390 },
  "Paid Social": { spend: 93, regs: 680, attendees: 340 },
  "Creator Partners": { spend: 59, regs: 350, attendees: 175 },
};
export const BASELINE_TOTAL_2025 = { spend: 274, attendees: 2050, walkIns: 125, showRate: 1925 / 2500 };
const ELASTICITY: Record<string, number> = { "Organic Search": 0.85, "Community Groups": 0.85, "Campus Ambassadors": 0.85, "Paid Social": 0.6, "Creator Partners": 0.6 };

export type PlanInputs = {
  collegesPitched: number; signRate: number; regsPerCollege: number; costPerSignedCollegeK: number; collegeFixedK: number;
  referralRate: number; referralRewardPerAttendee: number; referralToolingK: number;
  showRate: number; walkIns: number; showEngineK: number;
  spendK: Record<string, number>; budgetK: number; capacityPerDay: number; day1Share: number;
};

export const PRESETS: Record<"base" | "stretch", PlanInputs> = {
  base: { collegesPitched: 150, signRate: 0.3, regsPerCollege: 22, costPerSignedCollegeK: 1.5, collegeFixedK: 15, referralRate: 0.18, referralRewardPerAttendee: 100, referralToolingK: 7, showRate: 0.8, walkIns: 125, showEngineK: 20,
    spendK: { "Organic Search": 15, "Community Groups": 20, "Campus Ambassadors": 50, "Paid Social": 35, "Creator Partners": 0 }, budgetK: 300, capacityPerDay: 3000, day1Share: 0.7 },
  stretch: { collegesPitched: 200, signRate: 0.35, regsPerCollege: 25, costPerSignedCollegeK: 1.2, collegeFixedK: 15, referralRate: 0.28, referralRewardPerAttendee: 90, referralToolingK: 7, showRate: 0.85, walkIns: 300, showEngineK: 20,
    spendK: { "Organic Search": 15, "Community Groups": 20, "Campus Ambassadors": 45, "Paid Social": 20, "Creator Partners": 0 }, budgetK: 300, capacityPerDay: 3000, day1Share: 0.7 },
};

const BASE_SHOW = 0.758;

export function runPlan(p: PlanInputs) {
  const rows: { channel: string; spendK: number; regs: number; attendees: number; costPerAttendee: number | null; vs2025: number; basis: string }[] = [];
  const signed = p.collegesPitched * p.signRate;
  const cRegs = signed * p.regsPerCollege;
  const lift = p.showRate / BASE_SHOW;
  const att = (regs: number, a: number) => Math.min(a * lift, regs * 0.92);
  const cAtt = att(cRegs, cRegs * 0.86);
  rows.push({ channel: "College Partnerships", spendK: signed * p.costPerSignedCollegeK + p.collegeFixedK, regs: cRegs, attendees: cAtt, costPerAttendee: null, vs2025: 0, basis: `${p.collegesPitched} pitched × ${(p.signRate * 100).toFixed(0)}% sign × ${p.regsPerCollege} regs × 86% show (2025)` });
  for (const ch of Object.keys(ELASTICITY)) {
    const b = BASELINE_2025[ch]; const s = Math.max(0, p.spendK[ch] ?? 0);
    const k = s > 0 ? Math.pow(s / b.spend, ELASTICITY[ch]) : 0;
    rows.push({ channel: ch, spendK: s, regs: b.regs * k, attendees: att(b.regs * k, b.attendees * k), costPerAttendee: null, vs2025: 0, basis: `2025 result × (spend ratio)^${ELASTICITY[ch]}` });
  }
  const otherRegs = rows.reduce((a, r) => a + r.regs, 0);
  const rRegs = otherRegs * p.referralRate;
  const rAtt = att(rRegs, rRegs * 0.79);
  rows.push({ channel: "Student Referrals", spendK: (rAtt * p.referralRewardPerAttendee) / 1000 + p.referralToolingK, regs: rRegs, attendees: rAtt, costPerAttendee: null, vs2025: 0, basis: `${(p.referralRate * 100).toFixed(0)} referred regs per 100 others × 79% show (2025)` });
  for (const r of rows) { r.costPerAttendee = r.attendees ? (r.spendK * 1000) / r.attendees : null; r.vs2025 = r.attendees - (BASELINE_2025[r.channel]?.attendees ?? 0); }
  const regs = rows.reduce((a, r) => a + r.regs, 0);
  const registered = rows.reduce((a, r) => a + r.attendees, 0);
  const spendK = rows.reduce((a, r) => a + r.spendK, 0) + p.showEngineK;
  const attendees = registered + p.walkIns;
  const day1 = attendees * p.day1Share;
  return {
    rows, regs, registeredAttendees: registered, walkIns: p.walkIns, attendees, spendK, reserveK: p.budgetK - spendK,
    costPerAttendee: (spendK * 1000) / attendees, vs2025: attendees - BASELINE_TOTAL_2025.attendees,
    capacity: { day1, perDay: p.capacityPerDay, ok: day1 <= p.capacityPerDay },
    overBudget: spendK > p.budgetK,
  };
}

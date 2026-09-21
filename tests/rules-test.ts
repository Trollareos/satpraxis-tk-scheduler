import { strict as assert } from "node:assert";
import { recommendTechnicians, type HistoricalCounts } from "../src/recommend";
import { canonicalTechnicianName, type JobProvider, type ParsedSchedule, type ScheduleJob, type TechnicianDay } from "../src/xlsx";
import type { SearchResult } from "../src/tk-data";

const emptyHistory: HistoricalCounts = { generatedThrough: "2026-08-24", exact: {}, prefix3: {} };

function job(time: string | null, type: string, postcode = "17672", green = false, provider: JobProvider = "nova"): ScheduleJob {
  const minutes = time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : null;
  const workOrder = provider === "nova" ? "PS-TEST" : provider === "vodafone" ? "1-TEST" : null;
  return { row: 1, time, minutes, type, postcode, workOrder, provider, green };
}

function tech(name: string, jobs: ScheduleJob[] = [], red = true): TechnicianDay {
  return { name, canonicalName: canonicalTechnicianName(name), headerRow: 10, headerColumn: 3, red, jobs };
}

function result(technicians: TechnicianDay[], postcode = "17672", counts: HistoricalCounts = emptyHistory) {
  const schedule: ParsedSchedule = { sheetName: "TEST", technicians };
  return recommendTechnicians(schedule, postcode, counts);
}

assert.equal(canonicalTechnicianName("ΧΡΗΣΤΟΣ ΛΩΛΗΣ ΟΧΙ ΑΛΛΟ"), "ΧΡΗΣΤΟΣ ΛΩΛΗΣ");
assert.equal(canonicalTechnicianName("ΜΑΥΡΙΔΗΣ ΓΙΩΡΓΟΣ ΒΟΝΤΑ"), "ΜΑΥΡΙΔΗΣ ΓΙΩΡΓΟΣ");

assert.equal(result([tech("ΚΟΚΚΙΝΟΣ"), tech("ΓΚΡΙ", [], false)]).candidates.length, 1, "only red headers are candidates");
assert.equal(result([tech("ΤΕΧΝΙΚΟΣ VODAFONE")]).candidates.length, 1, "Vodafone in name/comment context is not exclusion");

const exactAnyTime = result([tech("ΙΔΙΟΣ ΤΚ", [job("09:00", "FTTH Activation")])]);
assert.equal(exactAnyTime.candidates.length, 1, "an existing appointment time must not block a day-only recommendation");
assert.equal(exactAnyTime.candidates[0].match, "exact", "the same postcode on the selected day must be an exact match");

const exactOverridesIncompleteRules = result([
  tech("ΤΣΟΛΚΑΣ ΑΠΟΣΤΟΛΟΣ", [
    job("08:30", "ΒΛΑΒΗ", "17778"),
    job("10:00", "FTTH Activation", "11852"),
    job("11:00", "FTTH Activation", "11743"),
  ]),
], "17778");
assert.equal(exactOverridesIncompleteRules.candidates.length, 1, "the same postcode must override incomplete geographic rules");
assert.equal(exactOverridesIncompleteRules.candidates[0].match, "exact");
assert(exactOverridesIncompleteRules.candidates[0].warnings.some((warning) => warning.includes("δεν αποκλείστηκε")), "mixed route should remain visible as a warning");

const deterministicRule: SearchResult = {
  postcode: "17672",
  group: "TEST",
  direct: ["17121"],
  indirect: ["11854"],
  excluded: ["15121"],
  note: "TEST",
  confidence: "TEST",
  status: "confirmed",
};
const ranked = recommendTechnicians(
  {
    sheetName: "TEST",
    technicians: [
      tech("ΙΣΤΟΡΙΚΟΣ"),
      tech("ΕΜΜΕΣΟΣ", [job("10:00", "ΒΛΑΒΗ", "11854")]),
      tech("ΑΜΕΣΟΣ", [job("10:00", "ΒΛΑΒΗ", "17121")]),
      tech("ΙΔΙΟΣ", [job("10:00", "ΒΛΑΒΗ", "17672")]),
    ],
  },
  "17672",
  { generatedThrough: "2026-08-24", exact: { "17672": { "ΙΣΤΟΡΙΚΟΣ": 20 } }, prefix3: {} },
  () => deterministicRule,
);
assert.deepEqual(ranked.candidates.map((candidate) => candidate.match), ["exact", "direct", "indirect", "history"], "ranking must be exact, direct, indirect, then history");

const fourActivations = ["09:00", "10:00", "11:00", "12:00"].map((time) => job(time, "FTTH Activation"));
const fullActivations = result([tech("ΤΕΧΝΙΚΟΣ", fourActivations)]);
assert.equal(fullActivations.candidates.length, 1, "four activations are informational in day-only mode");
assert(fullActivations.candidates[0].warnings.some((warning) => warning.includes("4 FTTH")), "four activations must produce a warning");
const sixOthers = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"].map((time) => job(time, "Combined Wind-AP"));
const fullOthers = result([tech("ΤΕΧΝΙΚΟΣ", sixOthers)]);
assert.equal(fullOthers.candidates.length, 1, "six other jobs are informational in day-only mode");
assert(fullOthers.candidates[0].warnings.some((warning) => warning.includes("6 λοιπές")), "six other jobs must produce a warning");
assert.equal(result([tech("ΤΕΧΝΙΚΟΣ", [job("09:00", "Combined Wind-AP")])]).candidates[0].activationCount, 0, "Combined is not an activation");

assert.equal(result([tech("ΤΕΧΝΙΚΟΣ ΑΔΕΙΑ")]).candidates.length, 0, "leave blocks");
const cutoff = result([tech("ΤΕΧΝΙΚΟΣ ΜΕΧΡΙ 11¨00")]);
assert.equal(cutoff.candidates.length, 1, "a cutoff is a warning because time is now selected manually");
assert(cutoff.candidates[0].warnings.some((warning) => warning.includes("11:00")), "cutoff warning must include the limit");
assert.equal(result([tech("ΤΕΧΝΙΚΟΣ ΝΑ ΜΗΝ ΑΛΛΑΞΕΙ")]).candidates.length, 1, "do-not-change allows a genuinely empty slot chosen manually");

assert.equal(result([tech("ΤΕΧΝΙΚΟΣ", [job("09:00", "Horizontal Construction")])]).candidates.length, 0, "horizontal-only route blocks NOVA");
assert.equal(result([tech("ΤΕΧΝΙΚΟΣ", [job("09:00", "FTTH Activation"), job("10:00", "Horizontal Construction")])]).candidates.length, 0, "non-green horizontal with NOVA blocks");
assert.equal(result([tech("ΤΕΧΝΙΚΟΣ", [job("09:00", "FTTH Activation"), job("10:00", "Horizontal Construction", "17672", true)])]).candidates.length, 1, "green combined horizontal with NOVA is allowed");
assert.equal(result([tech("ΤΕΧΝΙΚΟΣ", [job("10:00", "ΒΛΑΒΗ", "17672", true, "vodafone")])]).candidates.length, 0, "Vodafone-only route blocks NOVA");
assert.equal(result([tech("ΤΕΧΝΙΚΟΣ", [job("10:00", "ΒΛΑΒΗ", "17672", false, "unknown")])]).candidates.length, 0, "unknown-provider assignments do not become NOVA automatically");

const incompatibleRoute = recommendTechnicians(
  { sheetName: "TEST", technicians: [tech("ΙΣΤΟΡΙΚΟΣ", [job("08:30", "ΒΛΑΒΗ", "15121")])] },
  "15562",
  { generatedThrough: "2026-08-24", exact: { "15562": { "ΙΣΤΟΡΙΚΟΣ": 20 } }, prefix3: {} },
);
assert.equal(incompatibleRoute.candidates.length, 0, "history must never override an incompatible selected-day route");
assert.match(incompatibleRoute.rejected[0].blockers.join(" "), /15121/, "incompatible postcode should be named in the rejection");

const strongThreeMonthTrend = result([
  tech("ΤΕΧΝΙΚΟΣ 12462", [job("09:00", "FTTH Activation", "12462")]),
], "12461");
assert.equal(strongThreeMonthTrend.candidates[0].match, "direct", "strong three-month pairs must rank as direct matches");

const supportingThreeMonthTrend = result([
  tech("ΤΕΧΝΙΚΟΣ 11853", [job("09:00", "FTTH Activation", "11853")]),
], "11851");
assert.equal(supportingThreeMonthTrend.candidates[0].match, "indirect", "supporting three-month pairs must rank as indirect matches");

const protectedException = result([
  tech("ΤΕΧΝΙΚΟΣ 13122", [job("09:00", "FTTH Activation", "13122")]),
], "13121");
assert.equal(protectedException.candidates.length, 0, "explicit exclusions must override spreadsheet-derived trends");
assert.match(protectedException.rejected[0].blockers.join(" "), /13122/);

const explicit = recommendTechnicians(
  { sheetName: "TEST", technicians: [tech("ΑΛΛΟΣ ΤΕΧΝΙΚΟΣ"), tech("ΜΠΑΡΟΥΝΗΣ ΒΑΓΓΕΛΗΣ")] },
  "10671",
  emptyHistory,
);
assert(explicit.candidates[0].technician.name.includes("ΜΠΑΡΟΥΝΗΣ"), "explicit 106xx/114xx rule wins");

console.log("PASS: scheduling business rules, provider exclusions, ranking and protected exceptions.");

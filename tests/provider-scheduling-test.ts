import assert from "node:assert/strict";
import test from "node:test";
import { recommendTechnicians, type HistoricalCounts, type SchedulingProvider } from "../src/recommend";
import { canonicalTechnicianName, type JobProvider, type ScheduleJob, type TechnicianDay } from "../src/xlsx";
import type { SearchResult } from "../src/tk-data";

const history: HistoricalCounts = { generatedThrough: "2026-09-03", exact: {}, prefix3: {} };
const rule: SearchResult = { postcode: "17672", group: "TEST", direct: ["17121"], indirect: ["11854"], excluded: ["15121"], note: "TEST", confidence: "TEST", status: "confirmed" };
function job(provider: JobProvider, postcode = "17672", type = "ΒΛΑΒΗ", green = false): ScheduleJob {
  return { row: 2, time: "09:00", minutes: 540, type, postcode, workOrder: null, provider, green };
}
function tech(name: string, jobs: ScheduleJob[] = [], red = true): TechnicianDay {
  return { name, canonicalName: canonicalTechnicianName(name), headerRow: 1, headerColumn: 3, jobs, red };
}
function run(technicians: TechnicianDay[], provider: SchedulingProvider = "vodafone", counts = history) {
  return recommendTechnicians({ sheetName: "ΠΕΜ 1,10", technicians }, "17672", counts, () => rule, provider);
}

test("Vodafone-only routes become eligible in Vodafone mode and remain excluded in NOVA", () => {
  const technicians = [tech("VODAFONE", [job("vodafone")]), tech("NOVA", [job("nova")])];
  const vodafone = run(technicians);
  assert.equal(vodafone.provider, "vodafone");
  assert.deepEqual(vodafone.candidates.map(c => c.technician.name), ["VODAFONE"]);
  assert.equal(vodafone.candidates[0].match, "exact");
  assert.match(vodafone.rejected[0].blockers.join(" "), /Vodafone/);
  const nova = run(technicians, "nova");
  assert.deepEqual(nova.candidates.map(c => c.technician.name), ["NOVA"]);
  assert.equal(recommendTechnicians({ sheetName: "TEST", technicians }, "17672", history).provider, "nova");
});

test("mixed-route ranking uses exact/direct/indirect evidence from the chosen provider", () => {
  const technicians = [
    tech("ΜΙΚΤΟΣ", [job("nova"), job("vodafone", "17121")]),
    tech("ΙΔΙΟΣ VODAFONE", [job("vodafone")]),
    tech("ΕΜΜΕΣΟΣ", [job("vodafone", "11854")]),
  ];
  const vf = run(technicians);
  assert.deepEqual(vf.candidates.map(c => c.match), ["exact", "direct", "indirect"]);
  assert.equal(vf.candidates[1].technician.name, "ΜΙΚΤΟΣ");
  assert.equal(run(technicians, "nova").candidates[0].match, "exact");
});

test("other-provider postcodes still participate in geographic exclusions", () => {
  const result = run([tech("ΜΙΚΤΟΣ", [job("vodafone", "17121"), job("nova", "15121")])]);
  assert.equal(result.candidates.length, 0);
  assert.match(result.rejected[0].blockers.join(" "), /15121/);
  const exact = run([tech("ΜΙΚΤΟΣ", [job("vodafone"), job("nova", "15121")])]);
  assert.equal(exact.candidates.length, 1);
  assert.match(exact.candidates[0].warnings.join(" "), /15121/);
});

test("the 104xx/111xx prohibition applies across providers even with a selected-provider exact match", () => {
  for (const provider of ["nova", "vodafone"] as const) {
    const other = provider === "nova" ? "vodafone" : "nova";
    for (const [postcode, incompatible] of [["10443", "11143"], ["11143", "10443"]]) {
      const result = recommendTechnicians({ sheetName: "TEST", technicians: [tech("ΜΙΚΤΟΣ", [job(provider, postcode), job(other, incompatible)])] }, postcode, history, undefined, provider);
      assert.equal(result.candidates.length, 0);
      assert.match(result.rejected[0].blockers.join(" "), /104xx και 111xx/);
    }
  }
});

test("NOVA historical counts, manual trends and technician preference never rank Vodafone", () => {
  const counts: HistoricalCounts = { generatedThrough: "2026-09-03", exact: { "17672": { "ΙΣΤΟΡΙΚΟΣ": 100 } }, prefix3: { "176": { "ΙΣΤΟΡΙΚΟΣ": 100 } } };
  const vf = run([tech("ΙΣΤΟΡΙΚΟΣ")], "vodafone", counts).candidates[0];
  assert.equal(vf.match, "empty");
  assert.doesNotMatch(vf.reasons.join(" "), /Ιστορ/);
  assert.equal(run([tech("ΙΣΤΟΡΙΚΟΣ")], "nova", counts).candidates[0].match, "history");
  for (const [postcode, name] of [["19441", "ΜΑΥΡΟΓΙΑΝΝΗΣ ΣΤΑΜΑΤΗΣ"], ["10671", "ΜΠΑΡΟΥΝΗΣ ΒΑΓΓΕΛΗΣ"]]) {
    const result = recommendTechnicians({ sheetName: "TEST", technicians: [tech(name)] }, postcode, history, undefined, "vodafone");
    assert.equal(result.candidates[0].match, "empty");
    assert.doesNotMatch(result.candidates[0].reasons.join(" "), /Ιστορ|Ρητός κανόνας/);
  }
});

test("red headers and availability notes apply in Vodafone mode", () => {
  const result = run([
    tech("ΚΟΚΚΙΝΟΣ", [job("vodafone")]), tech("ΓΚΡΙ", [job("vodafone")], false),
    tech("ΑΛΛΟΣ ΑΔΕΙΑ", [job("vodafone")]), tech("ΑΛΛΟΣ ΟΧΙ ΑΛΛΟ", [job("vodafone")]),
  ]);
  assert.deepEqual(result.candidates.map(c => c.technician.name), ["ΚΟΚΚΙΝΟΣ"]);
  assert.equal(result.rejected.length, 2);
  const limited = run([tech("ΤΕΧΝΙΚΟΣ ΜΕΧΡΙ 11:00 ΝΑ ΜΗΝ ΑΛΛΑΞΕΙ", [job("vodafone")])]).candidates[0];
  assert.match(limited.warnings.join(" "), /11:00/);
  assert.match(limited.warnings.join(" "), /ΝΑ ΜΗΝ ΑΛΛΑΞΕΙ/);
});

test("empty technicians require manual Vodafone confirmation; unknown-only routes are rejected", () => {
  const result = run([tech("ΚΕΝΟΣ"), tech("ΑΓΝΩΣΤΟΣ", [job("unknown")])]);
  assert.equal(result.candidates.length, 1);
  assert.match(result.candidates[0].warnings.join(" "), /μπορεί να αναλάβει Vodafone/);
  assert.equal(result.rejected.length, 1);
  assert.match(run([tech("ΜΙΚΤΟΣ", [job("vodafone"), job("unknown")])]).candidates[0].warnings.join(" "), /άγνωστο κωδικό/);
});

test("workload totals include both providers without inventing Vodafone limits", () => {
  const jobs = [...Array.from({ length: 4 }, () => job("nova", "17672", "FTTH Activation")), ...Array.from({ length: 6 }, () => job("vodafone"))];
  const vf = run([tech("ΜΙΚΤΟΣ", jobs)]).candidates[0];
  assert.equal(vf.activationCount, 4);
  assert.equal(vf.otherCount, 6);
  assert.doesNotMatch(vf.warnings.join(" "), /4 FTTH|6 λοιπές/);
  assert.match(run([tech("ΜΙΚΤΟΣ", jobs)], "nova").candidates[0].warnings.join(" "), /4 FTTH/);
});

test("the existing Horizontal Construction restriction is retained in Vodafone mode", () => {
  assert.equal(run([tech("ΤΕΧΝΙΚΟΣ", [job("vodafone", "17672", "Horizontal Construction")])]).candidates.length, 0);
  const result = run([tech("ΤΕΧΝΙΚΟΣ", [job("vodafone", "17672", "Horizontal Construction", true)])]);
  assert.equal(result.candidates.length, 1);
  assert.match(result.candidates[0].warnings.join(" "), /Vodafone.*Horizontal/);
});

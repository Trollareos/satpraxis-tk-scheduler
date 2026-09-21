import assert from "node:assert/strict";
import { recommendTechnicians, type HistoricalCounts } from "../src/recommend";
import { canonicalTechnicianName, type ParsedSchedule, type ScheduleJob, type TechnicianDay } from "../src/xlsx";
import { resolvePostcode } from "../src/tk-data";

function technician(name: string, postcodes: string[]): TechnicianDay {
  const jobs: ScheduleJob[] = postcodes.map((postcode, index) => ({
    row: index + 11, time: `${index + 9}:00`, minutes: (index + 9) * 60,
    type: "FTTH Activation", postcode, workOrder: "PS-TEST", provider: "nova", green: false,
  }));
  return { name, canonicalName: canonicalTechnicianName(name), headerRow: 10, headerColumn: 3, red: true, jobs };
}

const emptyHistory: HistoricalCounts = { generatedThrough: "2026-09-03", exact: {}, prefix3: {} };

for (const [postcode, incompatible, compatible] of [["10441", "11141", "10446"], ["11141", "10441", "11147"]]) {
  const schedule: ParsedSchedule = {
    sheetName: "TEST",
    technicians: [
      technician("ΑΣΥΜΒΑΤΟΣ", [incompatible]),
      technician("ΜΙΚΤΟΣ ΜΕ ΙΔΙΟ ΤΚ", [postcode, incompatible]),
      technician("ΜΙΚΤΟΣ ΜΕ ΣΥΜΒΑΤΟ", ["11255", incompatible]),
      technician("ΣΥΜΒΑΤΟΣ", [compatible]),
      technician("ΙΔΙΟΣ ΤΚ", [postcode]),
    ],
  };
  const history: HistoricalCounts = {
    generatedThrough: "2026-09-03",
    exact: { [postcode]: { "ΑΣΥΜΒΑΤΟΣ": 100, "ΜΙΚΤΟΣ ΜΕ ΙΔΙΟ ΤΚ": 100 } },
    prefix3: { [postcode.slice(0, 3)]: { "ΜΙΚΤΟΣ ΜΕ ΣΥΜΒΑΤΟ": 100 } },
  };
  const result = recommendTechnicians(schedule, postcode, history);
  assert.deepEqual(result.candidates.map((item) => item.technician.name), ["ΙΔΙΟΣ ΤΚ", "ΣΥΜΒΑΤΟΣ"]);
  assert.equal(result.rejected.length, 3);
  for (const rejected of result.rejected) {
    assert.match(rejected.blockers.join(" "), /104xx και 111xx δεν συνδυάζονται/);
    assert(rejected.blockers.join(" ").includes(incompatible));
  }

  const stale = recommendTechnicians(schedule, postcode, history, () => ({
    ...resolvePostcode(postcode), direct: [incompatible.slice(0, 3) + "xx", compatible],
    indirect: [incompatible], excluded: [],
  }));
  assert.deepEqual(stale.candidates.map((item) => item.technician.name), ["ΙΔΙΟΣ ΤΚ", "ΣΥΜΒΑΤΟΣ"]);
  assert(stale.rule.excluded.includes(incompatible.slice(0, 3) + "xx"));
  assert(!stale.rule.direct.includes(incompatible.slice(0, 3) + "xx"));
  assert.equal(stale.rejected.length, 3);
}

// Preserve the existing same-postcode exception for incomplete geographic data.
const existingExact = recommendTechnicians({ sheetName: "TEST", technicians: [
  technician("ΤΣΟΛΚΑΣ ΑΠΟΣΤΟΛΟΣ", ["17778", "11852", "11743"]),
] }, "17778", emptyHistory);
assert.equal(existingExact.candidates.length, 1);
assert.equal(existingExact.candidates[0].match, "exact");

for (const postcode of ["10435", "10436", "10437", "10447", "10499", "11100", "11199"]) {
  const incompatible = postcode.startsWith("104") ? "11141" : "10441";
  const result = recommendTechnicians({ sheetName: "TEST", technicians: [technician("ΑΣΥΜΒΑΤΟΣ", [incompatible])] }, postcode, emptyHistory);
  assert.equal(result.candidates.length, 0, postcode);
  assert.equal(result.rejected.length, 1, postcode);
}

console.log("PASS: symmetric family exclusions, exact and indirect routes, stale updates, history, special postcodes and existing same-postcode behavior.");

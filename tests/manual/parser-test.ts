import { resolve } from "node:path";
const fixtureRoot = process.env.SATPRAXIS_FIXTURES || "fixtures";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { parseScheduleByName } from "../../src/xlsx";
import { recommendTechnicians, type HistoricalCounts } from "../../src/recommend";

const septemberWorkbook = readFileSync(resolve(fixtureRoot, "satpraxis_september_2026.xlsx"));
const schedule = parseScheduleByName(septemberWorkbook, "ΤΕΤ 2/09");
assert.equal(schedule.sheetName, "ΤΕΤ 2.09");
assert.equal(schedule.technicians.filter((technician) => technician.red).length, 58);
assert(schedule.technicians.some((technician) => technician.red && technician.jobs.length > 0), "current schedule should expose red technicians with assignments");

const augustWorkbook = readFileSync(resolve(fixtureRoot, "satpraxis_august_2026.xlsx"));
const oldSchedule = parseScheduleByName(augustWorkbook, "ΤΡΙ 25/08");

const mavridis = oldSchedule.technicians.find((technician) => technician.name.includes("ΜΑΥΡΙΔΗΣ"));
assert(mavridis, "ΜΑΥΡΙΔΗΣ should be parsed");
assert(mavridis.headerRow > 0, "technician header row should be available for deep-linking");
assert.equal(mavridis.jobs.filter((job) => job.type.includes("Horizontal")).length, 5);
assert(mavridis.jobs.some((job) => job.time === "13:00"));

assert(schedule.technicians.flatMap((technician) => technician.jobs).some((job) => job.green), "green Vodafone/special rows should be detected in the current workbook");

const emptyHistory: HistoricalCounts = {
  generatedThrough: "2026-08-24",
  exact: {},
  prefix3: {},
};
const result = recommendTechnicians(schedule, "19005", emptyHistory);
assert(result.candidates.every((candidate) => candidate.technician.red));
assert(result.rejected.length > 0, "incompatible current routes should be rejected");

console.log(JSON.stringify({
  sheet: schedule.sheetName,
  technicians: schedule.technicians.length,
  redTechnicians: schedule.technicians.filter((technician) => technician.red).length,
  eligibleForTest: result.candidates.length,
  rejectedForTest: result.rejected.length,
}, null, 2));

const nextDay = parseScheduleByName(augustWorkbook, "ΤΕΤ 26/08");
assert.equal(nextDay.sheetName, "ΤΕΤ 2608");
const tsokantas = nextDay.technicians.find((technician) => technician.name.includes("ΤΣΟΚΑΝΤΑΣ ΜΑΚΗΣ"));
assert(tsokantas, "ΤΣΟΚΑΝΤΑΣ ΜΑΚΗΣ should be parsed");
assert(tsokantas.jobs.length > 0, "the technician's assignments should be parsed");
assert(!tsokantas.jobs.some((job) => job.type.trim().toLocaleUpperCase("el-GR") === "ΕΡΓΑΣΙΑ"), "the column heading must not be counted as a job");
assert(tsokantas.jobs.every((job) => job.provider === "vodafone"), "the complete green block must be classified as Vodafone");
assert(tsokantas.jobs.some((job) => job.time && job.postcode), "timed assignment rows must be parsed");
assert(tsokantas.jobs.some((job) => /^(?:1-|VOD|VFS|VF)/i.test(job.workOrder || "")), "the final work-order column must be parsed");

const regressionNames = ["ΤΣΟΚΑΝΤΑΣ ΜΑΚΗΣ", "ΑΝΑΣΤΑΣΙΟΣ ΤΣΕΡΤΟΣ", "ΑΘΑΝΑΣΙΑΔΗΣ ΣΩΤΗΡΗΣ"];
const regressionSheet = {
  ...nextDay,
  technicians: nextDay.technicians
    .filter((technician) => regressionNames.some((name) => technician.name.includes(name)))
    .map((technician) => ({ ...technician, red: true })),
};
const regression15562 = recommendTechnicians(regressionSheet, "15562", {
  generatedThrough: "2026-08-24",
  exact: {
    "15562": {
      "ΑΝΑΣΤΑΣΙΟΣ ΤΣΕΡΤΟΣ": 4,
      "ΑΘΑΝΑΣΙΑΔΗΣ ΣΩΤΗΡΗΣ": 3,
    },
  },
  prefix3: {},
});
for (const name of ["ΤΣΟΚΑΝΤΑΣ ΜΑΚΗΣ", "ΑΝΑΣΤΑΣΙΟΣ ΤΣΕΡΤΟΣ", "ΑΘΑΝΑΣΙΑΔΗΣ ΣΩΤΗΡΗΣ"]) {
  assert(!regression15562.candidates.some((candidate) => candidate.technician.name.includes(name)), name + " must not be recommended for 15562");
}
assert(regression15562.rejected.find((candidate) => candidate.technician.name.includes("ΤΣΟΚΑΝΤΑΣ"))?.blockers.some((value) => value.includes("Vodafone")));
assert(regression15562.rejected.find((candidate) => candidate.technician.name.includes("ΑΝΑΣΤΑΣΙΟΣ ΤΣΕΡΤΟΣ"))?.blockers.some((value) => value.includes("Vodafone")), "an exact postcode must not override a Vodafone-only route");
assert(regression15562.rejected.find((candidate) => candidate.technician.name.includes("ΑΘΑΝΑΣΙΑΔΗΣ"))?.blockers.some((value) => value.includes("εκτός της ομάδας")));

console.log(JSON.stringify({
  regression: "15562 / 26-08 (day-only)",
  currentSheet: schedule.sheetName,
  currentRedTechnicians: schedule.technicians.filter((technician) => technician.red).length,
  tsokantasJobs: tsokantas.jobs,
  wrongTechniciansRejected: 3,
}, null, 2));

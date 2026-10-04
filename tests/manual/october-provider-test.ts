import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import historyJson from "../../src/history-data.json";
import { recommendTechnicians, type HistoricalCounts } from "../../src/recommend";
import { openWorkbook, parseScheduleSheet } from "../../src/xlsx";

const path = process.env.SATPRAXIS_OCTOBER_WORKBOOK || resolve(process.env.SATPRAXIS_FIXTURES || "fixtures", "satpraxis_october_2026.xlsx");
const book = openWorkbook(readFileSync(path));
const days = book.sheets.filter(sheet => sheet.name !== "INFO");
assert.equal(days.length, 31);
const totals = { searches: 0, vodafoneSearches: 0, vodafoneExactCandidates: 0, novaSearches: 0 };
for (const sheet of days.slice(0, 5)) {
  const schedule = parseScheduleSheet(book, sheet);
  for (const provider of ["nova", "vodafone"] as const) {
    const postcodes = [...new Set(schedule.technicians.filter(t => t.red).flatMap(t => t.jobs.filter(j => j.provider === provider && j.postcode).map(j => j.postcode!)))].slice(0, 8);
    for (const postcode of postcodes) {
      const result = recommendTechnicians(schedule, postcode, historyJson as HistoricalCounts, undefined, provider);
      totals.searches += 1;
      totals[provider === "nova" ? "novaSearches" : "vodafoneSearches"] += 1;
      for (const candidate of result.candidates) {
        assert(candidate.technician.red);
        if (candidate.technician.jobs.length) assert(candidate.technician.jobs.some(j => j.provider === provider));
        if (candidate.match === "exact") assert(candidate.technician.jobs.some(j => j.provider === provider && j.postcode === postcode));
        if (provider === "vodafone") {
          assert(!["history", "special"].includes(candidate.match));
          if (candidate.match === "exact") totals.vodafoneExactCandidates += 1;
        }
      }
    }
  }
}
assert(totals.vodafoneExactCandidates > 0, "the input snapshot must exercise real eligible Vodafone exact matches");
console.log("PASS: October provider scheduling:", totals);

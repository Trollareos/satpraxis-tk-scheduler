import { resolve } from "node:path";
const fixtureRoot = process.env.SATPRAXIS_FIXTURES || "fixtures";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { parseScheduleByName } from "../../src/xlsx";

const workbook = readFileSync(resolve(fixtureRoot, "satpraxis_september_2026.xlsx"));
const sheetNames = [
  "ΤΡΙ 1/09",
  "ΤΕΤ 2/09",
  "ΠΕΜ 3/09",
];

const reports = sheetNames.map((sheetName) => {
  const schedule = parseScheduleByName(workbook, sheetName);
  assert(schedule.technicians.some((technician) => technician.red), "current schedule must preserve red technician headers");
  const jobs = schedule.technicians.flatMap((technician) => technician.jobs);
  const counts = { nova: 0, vodafone: 0, unknown: 0 };
  const unknownIdentifiers = new Set<string>();
  for (const job of jobs) {
    counts[job.provider] += 1;
    const id = String(job.workOrder || "").toUpperCase();
    if (job.provider === "nova") assert(/^(?:PS|TAS)/.test(id), "confirmed NOVA must have PS/TAS identifier");
    if (job.provider === "vodafone" && id) assert(/^(?:1-|VOD|VFS|VF)/.test(id) || job.green, "Vodafone must be identified by code or green fill");
    if (job.provider === "unknown" && id) unknownIdentifiers.add(id);
  }
  return {
    sheet: schedule.sheetName,
    technicians: schedule.technicians.length,
    redTechnicians: schedule.technicians.filter((technician) => technician.red).length,
    jobs: jobs.length,
    providers: counts,
    unknownIdentifiers: [...unknownIdentifiers].sort(),
  };
});

console.log(JSON.stringify({ reports, providerAssertions: "passed" }, null, 2));

import { resolve } from "node:path";
const fixtureRoot = process.env.SATPRAXIS_FIXTURES || "fixtures";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import history from "../../src/history-data.json";
import { patternMatches, recommendTechnicians, type CandidateMatch } from "../../src/recommend";
import { parseScheduleByName } from "../../src/xlsx";

const septemberWorkbook = readFileSync(resolve(fixtureRoot, "satpraxis_september_2026.xlsx"));

const days = {
  "01/09": parseScheduleByName(septemberWorkbook, "ΤΡΙ 1/09"),
  "02/09": parseScheduleByName(septemberWorkbook, "ΤΕΤ 2/09"),
  "03/09": parseScheduleByName(septemberWorkbook, "ΠΕΜ 3/09"),
};

const samples: Array<{ day: keyof typeof days; postcode: string }> = [
  { day: "01/09", postcode: "17672" },
  { day: "01/09", postcode: "12131" },
  { day: "01/09", postcode: "12461" },
  { day: "02/09", postcode: "19005" },
  { day: "02/09", postcode: "10671" },
  { day: "02/09", postcode: "15562" },
  { day: "02/09", postcode: "13123" },
  { day: "03/09", postcode: "11255" },
  { day: "03/09", postcode: "11741" },
  { day: "03/09", postcode: "18547" },
];

const priority: Record<CandidateMatch, number> = { special: 0, exact: 1, direct: 2, indirect: 3, history: 4, empty: 5 };
const reports = [];
let totalCandidates = 0;
for (const sample of samples) {
  const schedule = days[sample.day];
  const result = recommendTechnicians(schedule, sample.postcode, history);
  for (const candidate of result.candidates) {
    assert(candidate.technician.red, "only red technicians may be recommended");
    assert.equal(candidate.blockers.length, 0, "recommended candidates cannot have blockers");
    assert(!candidate.technician.jobs.length || candidate.technician.jobs.some((job) => job.provider === "nova"), "a non-empty route needs confirmed NOVA PS/TAS work");
    const hasExactPostcode = candidate.technician.jobs.some((job) => job.postcode === sample.postcode);
    if (!hasExactPostcode) {
      assert(candidate.technician.jobs.every((job) => !job.postcode ||
        result.rule.direct.some((pattern) => patternMatches(job.postcode!, pattern)) ||
        result.rule.indirect.some((pattern) => patternMatches(job.postcode!, pattern))), "without an exact postcode, every routed postcode must be geographically compatible");
    }
  }
  for (let index = 1; index < result.candidates.length; index += 1) {
    assert(priority[result.candidates[index - 1].match] <= priority[result.candidates[index].match], "candidate categories must preserve exact/direct/indirect/history priority");
  }
  const eligibleExact = result.candidates.some((candidate) => candidate.technician.jobs.some((job) => job.postcode === sample.postcode));
  if (eligibleExact && !sample.postcode.startsWith("106") && !sample.postcode.startsWith("114")) {
    assert.equal(result.candidates[0].match, "exact", "an eligible technician with the same postcode must be first");
  }
  totalCandidates += result.candidates.length;
  reports.push({
    day: sample.day,
    postcode: sample.postcode,
    redTechnicians: schedule.technicians.filter((technician) => technician.red).length,
    eligible: result.candidates.length,
    topThree: result.candidates.slice(0, 3).map((candidate) => ({
      name: candidate.technician.name.trim(),
      match: candidate.match,
      score: candidate.score,
      route: candidate.technician.jobs.map((job) => ({ time: job.time, postcode: job.postcode, provider: job.provider })),
      reasons: candidate.reasons,
    })),
  });
}

assert(totalCandidates > 0, "the sample should contain at least one safe recommendation");

console.log(JSON.stringify({
  sheetsReadOnly: Object.values(days).map((schedule) => ({
    sheet: schedule.sheetName,
    redTechnicians: schedule.technicians.filter((technician) => technician.red).length,
  })),
  samples: reports,
  safetyAssertions: "passed",
}, null, 2));

import assert from "node:assert/strict";
import test from "node:test";
import { parseScheduleByName, providerFromWorkOrder } from "../src/xlsx";
import { scheduleFixture } from "./schedule-fixture";

test("recognizes all supported NOVA and Vodafone prefixes without assuming an unknown provider", () => {
  for (const value of ["1-123", "vod-123", "VFS123", " vf 123 "]) assert.equal(providerFromWorkOrder(value), "vodafone");
  for (const value of ["PS123", " tas-123 "]) assert.equal(providerFromWorkOrder(value), "nova");
  for (const value of [null, "", "OTHER123"]) assert.equal(providerFromWorkOrder(value), "unknown");
});
test("real XLSX parsing keeps red headers, uses green fallback and lets an explicit NOVA code override green", () => {
  const schedule = parseScheduleByName(scheduleFixture(), "ΠΕΜ 1,10");
  const technician = (name: string) => schedule.technicians.find(t => t.name === name)!;
  assert.equal(schedule.technicians.length, 7);
  assert.equal(schedule.technicians.filter(t => t.red).length, 6);
  assert.equal(technician("VODAFONE ΤΕΧΝΙΚΟΣ").jobs[0].provider, "vodafone");
  assert.equal(technician("ΠΡΑΣΙΝΟΣ ΧΩΡΙΣ ΚΩΔΙΚΟ").jobs[0].provider, "vodafone");
  assert.equal(technician("ΑΓΝΩΣΤΟΣ").jobs[0].provider, "unknown");
  const mixed = technician("ΜΙΚΤΟΣ ΤΕΧΝΙΚΟΣ");
  assert.equal(mixed.jobs[0].green, true);
  assert.deepEqual(mixed.jobs.map(j => j.provider), ["nova", "vodafone"]);
  assert.equal(parseScheduleByName(scheduleFixture(), "ΠΑΡ 2.10").sheetName, "ΠΑΡ 2,10");
});

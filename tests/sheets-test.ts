import assert from "node:assert/strict";
import test from "node:test";
import { parseSheetTabs } from "../src/sheets";

const item = (name: string, gid: number) => `items.push({name: "${name}", pageUrl: "test", gid: "${gid}"});`;
test("all 31 comma-separated October days are discovered and sorted", () => {
  const html = [item("INFO", 0), ...Array.from({ length: 31 }, (_, i) => item(`ΗΜΕΡΑ ${31 - i},10`, i + 1))].join("");
  const tabs = parseSheetTabs(html);
  assert.equal(tabs.length, 31);
  assert.equal(tabs[0].date, "2026-10-01");
  assert.equal(tabs[30].date, "2026-10-31");
  assert.equal(tabs[0].name, "ΗΜΕΡΑ 1,10");
});
test("previous month separators and escaped slashes still work", () => {
  const tabs = parseSheetTabs([item("ΔΕΥ 1.09", 1), item("ΤΡΙ 2/09", 2), item("ΤΕΤ 3-09", 3), item("ΠΕΜ 4\\/09", 4), item("ΠΑΡ 509", 5)].join(""));
  assert.deepEqual(tabs.map(t => t.date), [1, 2, 3, 4, 5].map(day => `2026-09-0${day}`));
});
test("invalid calendar dates and non-date tabs are ignored", () => {
  assert.equal(parseSheetTabs(["INFO", "ΤΚ", "ΗΜΕΡΑ 31,09", "ΗΜΕΡΑ 0,10", "ΗΜΕΡΑ 1,13", "ΗΜΕΡΑ 29,02"].map(item).join("")).length, 0);
});

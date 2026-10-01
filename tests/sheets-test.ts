import assert from "node:assert/strict";
import test from "node:test";
import { detectScheduleYear, parseSheetTabs } from "../src/sheets";

const item = (name: string, gid: number) => `items.push({name: "${name}", pageUrl: "test", gid: "${gid}"});`;
test("all 31 comma-separated October days are discovered and sorted", () => {
  const html = [item("INFO", 0), ...Array.from({ length: 31 }, (_, i) => item(`ΗΜΕΡΑ ${31 - i},10`, i + 1))].join("");
  const tabs = parseSheetTabs(html, 2026);
  assert.equal(tabs.length, 31);
  assert.equal(tabs[0].date, "2026-10-01");
  assert.equal(tabs[30].date, "2026-10-31");
  assert.equal(tabs[0].name, "ΗΜΕΡΑ 1,10");
});
test("previous month separators and escaped slashes still work", () => {
  const tabs = parseSheetTabs([item("ΔΕΥ 1.09", 1), item("ΤΡΙ 2/09", 2), item("ΤΕΤ 3-09", 3), item("ΠΕΜ 4\\/09", 4), item("ΠΑΡ 509", 5)].join(""), 2026);
  assert.deepEqual(tabs.map(t => t.date), [1, 2, 3, 4, 5].map(day => `2026-09-0${day}`));
});
test("invalid calendar dates and non-date tabs are ignored", () => {
  assert.equal(parseSheetTabs(["INFO", "ΤΚ", "ΗΜΕΡΑ 31,09", "ΗΜΕΡΑ 0,10", "ΗΜΕΡΑ 1,13", "ΗΜΕΡΑ 29,02"].map(item).join(""), 2026).length, 0);
});

test("yearless tabs use the current year by default and accept future years", () => {
  const html = item("ΗΜΕΡΑ 1.11", 1);
  assert.equal(parseSheetTabs(html)[0].date, `${new Date().getFullYear()}-11-01`);
  for (const year of [2027, 2028, 2035, 2100, 2400]) assert.equal(parseSheetTabs(html, year)[0].date, `${year}-11-01`);
});

test("full and abbreviated dates override the fallback year", () => {
  const html = [item("ΗΜΕΡΑ 2.11.2027", 1), item("ΗΜΕΡΑ 3/11/2027", 2), item("ΗΜΕΡΑ 4,11,27", 3), item("ΗΜΕΡΑ 5-11 2027", 4), item("ΗΜΕΡΑ 2028-01-02", 5)].join("");
  assert.deepEqual(parseSheetTabs(html, 2030).map(t => t.date), ["2027-11-02", "2027-11-03", "2027-11-04", "2027-11-05", "2028-01-02"]);
});

test("December to January follows tab order across the year boundary", () => {
  const html = [item("ΗΜΕΡΑ 30.12", 1), item("ΗΜΕΡΑ 31.12", 2), item("ΗΜΕΡΑ 1.01", 3), item("ΗΜΕΡΑ 2.01", 4)].join("");
  assert.deepEqual(parseSheetTabs(html, 2026).map(t => t.date), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
});

test("explicit years anchor neighbouring yearless tabs on both sides of New Year", () => {
  const html = [item("ΗΜΕΡΑ 31.12", 1), item("ΗΜΕΡΑ 1.01.2027", 2), item("ΗΜΕΡΑ 2.01", 3)].join("");
  assert.equal(detectScheduleYear(html, 2035), 2026);
  assert.deepEqual(parseSheetTabs(html, 2035).map(t => t.date), ["2026-12-31", "2027-01-01", "2027-01-02"]);
});

test("explicit years remain correct when fully dated tabs are not in chronological order", () => {
  const html = [item("ΗΜΕΡΑ 2028-01-02", 1), item("ΗΜΕΡΑ 2.11.2027", 2)].join("");
  assert.deepEqual(parseSheetTabs(html, 2040).map(t => t.date), ["2027-11-02", "2028-01-02"]);
});

test("the spreadsheet title identifies Greek/English month years and a four-digit year", () => {
  for (const title of ["ΝΟΕΜΒΡΙΟΣ 27.xlsx - Google Sheets", "Νοεμβρίου 2027", "NOVEMBER 2027", "ΠΡΟΓΡΑΜΜΑ 2027 - Google Sheets", "&#925;ΟΕΜΒΡΙΟΣ 27.xlsx"]) {
    assert.equal(detectScheduleYear(`<title>${title}</title>${item("ΗΜΕΡΑ 1.11", 1)}`, 2026), 2027, title);
  }
  assert.equal(detectScheduleYear('<title>ΟΚΤΩΒΡΙΟΣ 26.xlsx</title>', 2027), 2026, "older schedules retain their title year");
  assert.equal(detectScheduleYear('<title>Unknown schedule</title>', 2035), 2035);
  assert.equal(detectScheduleYear('<title>2026 / 2027</title>', 2035), 2035, "an ambiguous title requires the visible year setting");
});

test("a January title with previous December tabs identifies the starting year", () => {
  const html = `<title>ΙΑΝΟΥΑΡΙΟΣ 27.xlsx</title>${item("ΗΜΕΡΑ 31.12", 1)}${item("ΗΜΕΡΑ 1.01", 2)}`;
  const year = detectScheduleYear(html, 2026);
  assert.equal(year, 2026);
  assert.deepEqual(parseSheetTabs(html, year).map(t => t.date), ["2026-12-31", "2027-01-01"]);
});

test("two-digit years follow the nearest reference century", () => {
  assert.equal(detectScheduleYear('<title>ΙΑΝΟΥΑΡΙΟΣ 00.xlsx</title>', 2099), 2100);
  assert.equal(parseSheetTabs(item("ΗΜΕΡΑ 1.01.00", 1), 2099)[0].date, "2100-01-01");
});

test("leap-day validation follows the actual year, including century rules", () => {
  const html = item("ΗΜΕΡΑ 29.02", 1);
  assert.equal(parseSheetTabs(html, 2027).length, 0);
  assert.equal(parseSheetTabs(html, 2028)[0].date, "2028-02-29");
  assert.equal(parseSheetTabs(html, 2100).length, 0);
  assert.equal(parseSheetTabs(html, 2400)[0].date, "2400-02-29");
  assert.equal(parseSheetTabs(item("ΗΜΕΡΑ 29.02.2028", 1), 2027)[0].date, "2028-02-29");
});

test("invalid years are rejected and parsing preserves exact tab names and gids", () => {
  for (const year of [NaN, 0, 99, 2027.5, 10000]) assert.throws(() => parseSheetTabs(item("ΗΜΕΡΑ 1.11", 1), year), /έτος/);
  const name = 'ΠΕΜ 1,10 "Ομάδα"';
  const html = `items.push({name: ${JSON.stringify(name)}, gid: "123"});`;
  assert.deepEqual(parseSheetTabs(html, 2027), [{ name, gid: "123", date: "2027-10-01" }]);
});

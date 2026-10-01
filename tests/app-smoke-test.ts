import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { scheduleFixture } from "./schedule-fixture";

class FakeElement {
  tagName: string;
  id: string;
  children: FakeElement[] = [];
  text = "";
  className = "";
  value = "";
  hidden = false;
  disabled = false;
  style = {};
  dataset: Record<string, string> = {};
  listeners = new Map<string, Function[]>();
  classList = { toggle() {} };
  constructor(tag = "div", id = "") { this.tagName = tag; this.id = id; }
  get textContent(): string { return this.text + this.children.map(c => c.textContent).join(""); }
  set textContent(value: string) { this.text = String(value); this.children = []; }
  append(...items: FakeElement[]) { this.children.push(...items); }
  replaceChildren(...items: FakeElement[]) { this.text = ""; this.children = items; }
  addEventListener(type: string, fn: Function) { this.listeners.set(type, [...this.listeners.get(type) || [], fn]); }
  async emit(type: string) { for (const fn of this.listeners.get(type) || []) await fn({ currentTarget: this, preventDefault() {} }); }
  setAttribute() {}
  scrollIntoView() {}
}

const template = await readFile("src/template.html", "utf8");
assert.match(template, /id="appointment-provider"/);
assert.doesNotMatch(template, /appointment-time|appointment-kind/);
const elements = new Map([...template.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)].map(m => [m[2], new FakeElement(m[1], m[2])]));
elements.get("appointment-provider")!.value = "nova";
elements.get("schedule-result")!.hidden = true;
const storage = new Map([["satpraxis-scheduler-sheet-v1", "OLD-ID"]]);
const clipboard: string[] = [];
const calls: string[] = [];
let workbook = scheduleFixture();
let catalogHtml = '<title>ΟΚΤΩΒΡΙΟΣ 26.xlsx</title>items.push({name: "ΠΕΜ 1,10", gid: "101"});items.push({name: "ΠΑΡ 2,10", gid: "102"});';
let clock = "2026-12-31T12:00:00Z";
class AppDate extends Date {
  constructor(value?: string | number) { super(value === undefined ? clock : value); }
  static now() { return new Date(clock).getTime(); }
  getFullYear() { return this.getUTCFullYear(); }
  getMonth() { return this.getUTCMonth(); }
  getDate() { return this.getUTCDate(); }
}
let timer: Function;
let deferNext = false;
let release: (() => void) | null = null;
const fetch = async (url: string) => {
  calls.push(url);
  if (url.startsWith("/api/sheets?")) return { ok: true, text: async () => catalogHtml };
  assert(url.startsWith("/api/sheet?"));
  if (deferNext) {
    deferNext = false;
    await new Promise<void>(resolve => { release = resolve; });
  }
  return { ok: true, arrayBuffer: async () => workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength) };
};
const context: Record<string, unknown> = {
  document: { getElementById: (id: string) => elements.get(id), createElement: (tag: string) => new FakeElement(tag), querySelectorAll: () => [] },
  localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  navigator: { clipboard: { writeText: async (value: string) => { clipboard.push(value); } } },
  fetch, console, TextDecoder, Uint8Array, ArrayBuffer, Blob, Date: AppDate,
  setTimeout: () => 1, clearTimeout() {}, setInterval: (fn: Function) => { timer = fn; return 1; },
};
context.window = context;
context.globalThis = context;
vm.runInNewContext(await readFile(".test-build/app.js", "utf8"), context);
const el = (id: string) => elements.get(id)!;
const tick = () => new Promise(resolve => setImmediate(resolve));
const submit = async () => { await el("appointment-form").emit("submit"); await tick(); };
const visible = () => el("schedule-result").textContent.split("Κανόνας ΤΚ που χρησιμοποιήθηκε")[0];
const descendants = (node: FakeElement): FakeElement[] => [node, ...node.children.flatMap(descendants)];

assert.equal(el("appointment-provider").disabled, true);
assert.equal(calls.length, 0);
assert.equal(storage.has("satpraxis-scheduler-sheet-v1"), false);
timer!(); await tick();
assert.equal(calls.length, 0, "automatic refresh must not fetch or show an input error before a search");
assert.equal(el("toast").textContent, "");

el("spreadsheet-url").value = "https://docs.google.com/spreadsheets/d/SYNTHETIC_SCHEDULE_ID_0001/edit";
await el("save-spreadsheet").emit("click");
assert.equal(el("appointment-date").children.length, 2, "comma-separated October tabs must be available in the UI");
assert.equal(el("appointment-provider").disabled, false);
el("appointment-date").value = "101";
el("appointment-postcode").value = "17672";
await submit();
assert.match(visible(), /LIVE ΑΠΟΤΕΛΕΣΜΑ · NOVA/);
assert.match(visible(), /NOVA ΤΕΧΝΙΚΟΣ/);
assert.doesNotMatch(visible(), /VODAFONE ΤΕΧΝΙΚΟΣ/);

el("appointment-provider").value = "vodafone";
await el("appointment-provider").emit("change");
assert.equal(el("schedule-result").hidden, true, "switching provider must hide the old result");
const beforeSwitchTimer = calls.length;
timer!(); await tick();
assert.equal(calls.length, beforeSwitchTimer, "auto refresh must not reuse the old provider query");
await submit();
assert.match(visible(), /LIVE ΑΠΟΤΕΛΕΣΜΑ · Vodafone/);
assert.match(visible(), /VODAFONE ΤΕΧΝΙΚΟΣ/);
assert.doesNotMatch(visible(), /NOVA ΤΕΧΝΙΚΟΣ|\/4 FTTH|\/6 λοιπές/);
const copy = descendants(el("schedule-result")).find(n => n.tagName === "button" && n.textContent === "Αντιγραφή πρότασης")!;
await copy.emit("click");
assert.match(clipboard[0], /Πάροχος: Vodafone/);
const beforeRefresh = calls.length;
timer!(); await tick();
assert.equal(calls.length, beforeRefresh + 1);
assert.match(visible(), /LIVE ΑΠΟΤΕΛΕΣΜΑ · Vodafone/);

// Change away and back while a request is pending: equality alone is insufficient.
deferNext = true;
await submit();
assert(release);
el("appointment-provider").value = "nova";
await el("appointment-provider").emit("change");
el("appointment-provider").value = "vodafone";
await el("appointment-provider").emit("change");
release!(); await tick();
assert.equal(el("schedule-result").hidden, true, "a stale request must not revive a result after selection changes");
assert.equal(el("recommend-button").disabled, false);
await submit();
assert.match(visible(), /LIVE ΑΠΟΤΕΛΕΣΜΑ · Vodafone/);
el("appointment-date").value = "102";
await el("appointment-date").emit("change");
assert.equal(el("schedule-result").hidden, true);
await submit();
assert.match(visible(), /ΠΑΡ 2,10/);
assert.equal(storage.has("satpraxis-scheduler-sheet-v1"), false);

assert.equal(el("spreadsheet-year").value, "2026");
const beforeYearChange = calls.length;
el("spreadsheet-year").value = "2027";
await el("spreadsheet-year").emit("input");
await el("spreadsheet-year").emit("change");
assert.equal(el("schedule-result").hidden, true);
assert.equal(calls.length, beforeYearChange, "changing a year reuses the loaded tab catalogue");
assert.equal(el("appointment-date").children[0].dataset.date, "2027-10-01");
assert.match(el("appointment-date").children[0].textContent, /2027/);
timer!(); await tick();
assert.equal(calls.length, beforeYearChange, "year changes cancel the old automatic refresh query");
await submit();
assert.match(visible(), /02\/10\/2027/);
await descendants(el("schedule-result")).find(n => n.tagName === "button" && n.textContent === "Αντιγραφή πρότασης")!.emit("click");
assert.match(clipboard.at(-1)!, /02\/10\/2027/);

el("spreadsheet-year").value = "2027.5";
await el("spreadsheet-year").emit("change");
assert.equal(el("spreadsheet-year").value, "2027");
assert.match(el("toast").textContent, /έγκυρο τετραψήφιο έτος/);
assert.equal(el("schedule-result").hidden, true);

deferNext = true;
await submit();
el("spreadsheet-year").value = "2030";
await el("spreadsheet-year").emit("change");
el("spreadsheet-year").value = "2027";
await el("spreadsheet-year").emit("change");
release!(); await tick();
assert.equal(el("schedule-result").hidden, true, "a year change cancels a pending result even after the original year is restored");

await el("detect-year").emit("click");
assert.equal(el("spreadsheet-year").value, "2026", "automatic year can be restored after a manual override");
catalogHtml = '<title>ΙΑΝΟΥΑΡΙΟΣ 27.xlsx</title>items.push({name: "ΠΕΜ 31,12", gid: "101"});items.push({name: "ΠΑΡ 1,01", gid: "102"});';
workbook = scheduleFixture(["ΠΕΜ 31,12", "ΠΑΡ 1,01"]);
el("spreadsheet-url").value = "https://docs.google.com/spreadsheets/d/SYNTHETIC_SCHEDULE_ID_0002/edit";
await el("save-spreadsheet").emit("click");
assert.equal(el("appointment-date").value, "101", "a new workbook chooses today rather than a reused gid from the old workbook");
assert.deepEqual(el("appointment-date").children.map(option => option.dataset.date), ["2026-12-31", "2027-01-01"]);
clock = "2027-01-01T12:00:00Z";
el("spreadsheet-url").value = "https://docs.google.com/spreadsheets/d/SYNTHETIC_SCHEDULE_ID_0003/edit";
await el("save-spreadsheet").emit("click");
assert.equal(el("appointment-date").value, "102", "today is selected correctly after New Year");
await submit();
assert.match(visible(), /01\/01\/2027/);

catalogHtml = 'items.push({name: "ΠΑΡ 1,01", gid: "101"});items.push({name: "ΣΑΒ 2,01", gid: "102"});';
workbook = scheduleFixture(["ΠΑΡ 1,01", "ΣΑΒ 2,01"]);
el("spreadsheet-url").value = "https://docs.google.com/spreadsheets/d/SYNTHETIC_SCHEDULE_ID_0004/edit";
await el("save-spreadsheet").emit("click");
assert.equal(el("spreadsheet-year").value, "2027", "the fallback year advances with the computer clock");
assert.equal(el("appointment-date").children[0].dataset.date, "2027-01-01");
await submit();
assert.match(visible(), /01\/01\/2027/);

catalogHtml = '<title>Πρόγραμμα 2026</title>items.push({name: "ΤΡΙ 29.02.2028", gid: "101"});items.push({name: "ΤΕΤ 1.03.2028", gid: "102"});';
workbook = scheduleFixture(["ΤΡΙ 29.02.2028", "ΤΕΤ 1.03.2028"]);
el("spreadsheet-url").value = "https://docs.google.com/spreadsheets/d/SYNTHETIC_SCHEDULE_ID_0005/edit";
await el("save-spreadsheet").emit("click");
assert.equal(el("spreadsheet-year").value, "2028", "explicit tab years override an older workbook title");
assert.equal(el("appointment-date").children[0].dataset.date, "2028-02-29");
await submit();
assert.match(visible(), /29\/02\/2028/);
console.log("PASS: provider selection, dynamic years, December/January, copy, refresh and stale-request protection in the app UI.");

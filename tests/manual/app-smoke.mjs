import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { resolve } from "node:path";

class FakeNode {
  constructor(text = "") { this._text = text; this.children = []; this.parent = null; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent || "").join(""); }
  append(...items) { for (const item of items) { const node = typeof item === "string" ? new FakeNode(item) : item; node.parent = this; this.children.push(node); } }
  replaceChildren(...items) { this.children = []; this._text = ""; this.append(...items); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
}

class FakeElement extends FakeNode {
  constructor(tagName = "div", id = "") {
    super();
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = "";
    this.hidden = false;
    this.value = "";
    this.disabled = false;
    this.files = [];
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = { toggle: (name, active) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      if (active) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(" ");
    } };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  async emit(type, extras = {}) {
    const event = { type, target: this, currentTarget: this, preventDefault() {}, ...extras };
    for (const listener of this.listeners.get(type) || []) await listener(event);
  }
  click() { return this.emit("click"); }
  focus() {}
  select() {}
  scrollIntoView() {}
}

const html = await readFile(new URL("../../dist/Satpraxis_TK_Scheduler_Test_v9/Satpraxis_TK_Scheduler_Test.html", import.meta.url), "utf8");
assert.match(html, /Satpraxis TK Scheduler/);
assert.match(html, /connect-src 'self'/);
assert.doesNotMatch(html, /chatgpt/i);
assert.doesNotMatch(html, /id="appointment-time"/);
assert.doesNotMatch(html, /id="appointment-kind"/);
assert.doesNotMatch(html, /1sk7Lpb7pdUfy5INU6TdgLHVvn1hmH6oo/);
assert.match(html, /Δεν υπάρχει προεπιλεγμένο spreadsheet/);
assert.match(html, /υπερισχύει των ημιτελών γεωγραφικών κανόνων/);
const script = html.match(/<script>([\s\S]*)<\/script>/i)?.[1];
assert(script, "inline bundle is missing");

const tagById = {
  "connection-status": "div", "schedule-view": "section", "tk-view": "section",
  "appointment-form": "form", "appointment-postcode": "input", "appointment-date": "select", "appointment-provider": "select",
  "recommend-button": "button",
  "refresh-indicator": "span", "schedule-result": "article", "last-refresh-note": "p",
  "spreadsheet-settings": "details", "spreadsheet-url": "input", "spreadsheet-year": "input", "detect-year": "button", "reload-sheets": "button", "save-spreadsheet": "button",
  "tk-data-status": "strong", "tk-form": "form", "tk-postcode": "input", "tk-result": "article",
  "import-update": "button", "update-file": "input", toast: "div",
};
const elements = new Map(Object.entries(tagById).map(([id, tag]) => [id, new FakeElement(tag, id)]));
elements.get("appointment-provider").value = "nova";
elements.get("schedule-result").hidden = true;
elements.get("tk-result").hidden = true;
elements.get("tk-view").hidden = true;
const scheduleTab = new FakeElement("button"); scheduleTab.dataset.view = "schedule"; scheduleTab.className = "tab-button tab-button--active";
const tkTab = new FakeElement("button"); tkTab.dataset.view = "tk"; tkTab.className = "tab-button";

const document = {
  body: new FakeElement("body"),
  getElementById: (id) => elements.get(id) || null,
  createElement: (tag) => new FakeElement(tag),
  querySelectorAll: (selector) => selector === "[data-view]" ? [scheduleTab, tkTab] : [],
  execCommand: () => true,
};
const storage = new Map();
storage.set("satpraxis-scheduler-sheet-v1", "OLD-SAVED-ID-MUST-BE-IGNORED");
const localStorage = {
  getItem: (key) => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const sheetHtml = [
  'items.push({name: "ΤΡΙ 1.09", pageUrl: "x", gid: "653716352",initialSheet: true});',
  'items.push({name: "ΤΕΤ 2.09", pageUrl: "x", gid: "497856695",initialSheet: false});',
  'items.push({name: "ΠΕΜ 3.09", pageUrl: "x", gid: "2072863410",initialSheet: false});',
].join("");
const septemberWorkbook = await readFile(resolve(process.env.SATPRAXIS_FIXTURES || "fixtures", "satpraxis_september_2026.xlsx"));
const liveWorkbooks = new Map([
  ["653716352", septemberWorkbook],
  ["497856695", septemberWorkbook],
  ["2072863410", septemberWorkbook],
]);
const fetchCalls = [];
const fetch = async (url) => {
  fetchCalls.push(String(url));
  if (String(url).startsWith("/api/sheets")) return { ok: true, text: async () => sheetHtml };
  if (String(url).startsWith("/api/sheet")) {
    const gid = new URL(String(url), "http://local.test").searchParams.get("gid");
    const liveWorkbook = liveWorkbooks.get(gid);
    if (!liveWorkbook) throw new Error("Unexpected gid: " + gid);
    return {
      ok: true,
      arrayBuffer: async () => liveWorkbook.buffer.slice(liveWorkbook.byteOffset, liveWorkbook.byteOffset + liveWorkbook.byteLength),
    };
  }
  throw new Error("Unexpected fetch: " + url);
};
const context = {
  document, localStorage, navigator: {}, fetch, console,
  TextDecoder, Uint8Array, ArrayBuffer, Blob,
  setTimeout, clearTimeout, setInterval: () => 1,
  Date, RegExp, Map, Set, URL,
};
context.window = context;
context.globalThis = context;
vm.runInNewContext(script, context, { filename: "scheduler-app.js" });
await new Promise((resolve) => setTimeout(resolve, 0));

assert.match(elements.get("connection-status").textContent, /Δεν έχει επιλεγεί spreadsheet/);
assert.equal(elements.get("appointment-postcode").disabled, true);
assert.equal(elements.get("appointment-date").disabled, true);
assert.equal(elements.get("recommend-button").disabled, true);
assert.equal(fetchCalls.length, 0, "startup must not load a default spreadsheet");
assert.equal(storage.has("satpraxis-scheduler-sheet-v1"), false, "legacy saved spreadsheet must be removed");

elements.get("spreadsheet-settings").open = true;
elements.get("spreadsheet-url").value = "https://docs.google.com/spreadsheets/d/12jqZWhdn2KWXZFr1SAx3Wqkb5mkLdE0l/edit";
await elements.get("save-spreadsheet").emit("click");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.match(elements.get("connection-status").textContent, /Live σύνδεση/);
assert.equal(elements.get("appointment-date").value, "2072863410");
assert.equal(elements.get("appointment-postcode").disabled, false);
assert.equal(elements.get("appointment-date").disabled, false);
assert.equal(elements.get("recommend-button").disabled, false);
assert.equal(elements.get("spreadsheet-settings").open, false);
assert.equal(storage.has("satpraxis-scheduler-sheet-v1"), false, "connected spreadsheet must remain session-only");

elements.get("tk-postcode").value = "12131";
await elements.get("tk-form").emit("submit");
assert.match(elements.get("tk-result").textContent, /12131/);
assert.match(elements.get("tk-result").textContent, /12462/);
assert.match(elements.get("tk-result").textContent, /12243/);

elements.get("appointment-postcode").value = "17672";
await elements.get("appointment-form").emit("submit");
await new Promise((resolve) => setTimeout(resolve, 100));
assert.match(elements.get("schedule-result").textContent, /LIVE ΑΠΟΤΕΛΕΣΜΑ/);
assert.match(elements.get("schedule-result").textContent, /ΚΥΡΙΑ ΠΡΟΤΑΣΗ/);
assert.match(elements.get("schedule-result").textContent, /Ανανέωση τώρα/);

elements.get("appointment-date").value = "653716352";
elements.get("appointment-postcode").value = "15562";
await elements.get("appointment-form").emit("submit");
await new Promise((resolve) => setTimeout(resolve, 100));
const visibleCandidates = elements.get("schedule-result").textContent.split("Κανόνας ΤΚ που χρησιμοποιήθηκε")[0];
assert.match(visibleCandidates, /Ίδιος ΤΚ/);
assert.match(visibleCandidates, /Έχει ήδη τον ίδιο ΤΚ την επιλεγμένη ημέρα \(15562\)/);
assert.match(visibleCandidates, /ΤΖΙΑΚΑΣ ΔΗΜΗΤΡΗΣ/);

await tkTab.emit("click");
assert.equal(elements.get("tk-view").hidden, false);
assert.equal(elements.get("schedule-view").hidden, true);

console.log("Scheduler app smoke tests passed");

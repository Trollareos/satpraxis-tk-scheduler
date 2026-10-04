import { enforcePostcodeFamilySeparation, resolvePostcode as resolveBuiltInPostcode, type ResultStatus, type SearchResult } from "./tk-data";
import historyJson from "./history-data.json";
import { parseScheduleByName, type ParsedSchedule } from "./xlsx";
import {
  recommendTechnicians,
  type Candidate,
  type HistoricalCounts,
  type Recommendation,
  type SchedulingProvider,
} from "./recommend";
import { detectScheduleYear, extractSpreadsheetId, isScheduleYear, parseSheetTabs, type SheetTab } from "./sheets";

type ImportedRule = {
  match: string;
  group: string;
  status: ResultStatus;
  confidence: string;
  direct: string[];
  indirect: string[];
  excluded: string[];
  note: string;
  bidirectional: boolean;
  priority: number;
};

type StoredUpdate = {
  dataVersion: string;
  sourceFile: string;
  storedAt: string;
  rules: ImportedRule[];
};

const UPDATE_STORAGE_KEY = "satpraxis-tk-finder-update-v1";
const HISTORY = historyJson as HistoricalCounts;
const REFRESH_INTERVAL = 60_000;

let spreadsheetId = "";
let sheets: SheetTab[] = [];
let sheetCatalogHtml = "";
let calendarYear = new Date().getFullYear();
let manualCalendarYear = false;
let lastSchedule: ParsedSchedule | null = null;
let lastRecommendation: Recommendation | null = null;
let lastRefresh: Date | null = null;
let refreshInFlight = false;
type SearchValues = { postcode: string; gid: string; provider: SchedulingProvider; year: number };
let lastSubmitted: SearchValues | null = null;
let searchRevision = 0;
let storedUpdate = loadStoredUpdate();
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error("Missing element: " + id);
  return element as T;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizePostcode(value: string): string {
  const match = String(value || "").match(/1\d{4}/);
  return match ? match[0] : String(value || "").replace(/\D/g, "").slice(0, 5);
}

function normalizePattern(value: string): string {
  return value.trim().replace(/[XΧχ]/g, "x").replace(/[–—]/g, "-");
}

function patternMatches(postcode: string, rawPattern: string): boolean {
  const pattern = normalizePattern(rawPattern);
  if (/^1\d{4}$/.test(pattern)) return postcode === pattern;
  if (/^1[\dx]{4}$/.test(pattern)) return new RegExp("^" + pattern.replace(/x/g, "\\d") + "$").test(postcode);
  const range = pattern.match(/^(1\d{4})-(1\d{4})$/);
  return Boolean(range && Number(postcode) >= Number(range[1]) && Number(postcode) <= Number(range[2]));
}

function loadStoredUpdate(): StoredUpdate {
  const empty: StoredUpdate = { dataVersion: "", sourceFile: "", storedAt: "", rules: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(UPDATE_STORAGE_KEY) || "null") as StoredUpdate | null;
    return parsed && Array.isArray(parsed.rules) ? parsed : empty;
  } catch {
    return empty;
  }
}

function selectImportedRule(postcode: string): ImportedRule | null {
  const specificity = (rule: ImportedRule): number => {
    const match = normalizePattern(rule.match);
    if (/^1\d{4}$/.test(match)) return rule.priority * 1_000_000 + 500_000;
    const range = match.match(/^(1\d{4})-(1\d{4})$/);
    if (range) return rule.priority * 1_000_000 + 300_000 - (Number(range[2]) - Number(range[1]));
    return rule.priority * 1_000_000 + (match.match(/\d/g) || []).length * 1_000;
  };
  return storedUpdate.rules
    .filter((rule) => patternMatches(postcode, rule.match))
    .sort((first, second) => specificity(second) - specificity(first))[0] || null;
}

function resultFromImportedRule(postcode: string, rule: ImportedRule): SearchResult {
  const direct = unique(rule.direct).filter((value) => value !== postcode);
  const indirect = unique(rule.indirect).filter((value) => value !== postcode && !direct.includes(value));
  return {
    postcode,
    group: rule.group,
    direct,
    indirect,
    excluded: unique(rule.excluded),
    note: rule.note + (storedUpdate.dataVersion ? " Εφαρμόστηκε από την τοπική ενημέρωση " + storedUpdate.dataVersion + "." : ""),
    confidence: rule.confidence,
    status: rule.status,
  };
}

function resolvePostcode(postcode: string): SearchResult {
  const imported = selectImportedRule(postcode);
  if (imported) return enforcePostcodeFamilySeparation(resultFromImportedRule(postcode, imported));
  const builtIn = resolveBuiltInPostcode(postcode);
  const direct = [...builtIn.direct];
  const indirect = [...builtIn.indirect];
  let inverse = false;
  for (const rule of storedUpdate.rules) {
    if (!rule.bidirectional || patternMatches(postcode, rule.match)) continue;
    if (rule.direct.some((pattern) => patternMatches(postcode, pattern))) {
      direct.push(rule.match);
      inverse = true;
    }
    if (rule.indirect.some((pattern) => patternMatches(postcode, pattern))) {
      indirect.push(rule.match);
      inverse = true;
    }
  }
  if (!inverse) return builtIn;
  const finalDirect = unique(direct).filter((value) => value !== postcode);
  const finalIndirect = unique(indirect).filter((value) => value !== postcode && !finalDirect.includes(value));
  return enforcePostcodeFamilySeparation({
    ...builtIn,
    direct: finalDirect,
    indirect: finalIndirect,
    status: builtIn.status === "unknown" ? "trend" : builtIn.status,
    group: builtIn.status === "unknown" ? "Συσχετισμός τοπικής ενημέρωσης" : builtIn.group,
    confidence: builtIn.status === "unknown" ? "Τοπική ενημέρωση" : builtIn.confidence,
  });
}

function todayLocal(): string {
  const date = new Date();
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function setSchedulerReady(ready: boolean): void {
  const postcode = byId<HTMLInputElement>("appointment-postcode");
  postcode.disabled = !ready;
  postcode.placeholder = ready ? "π.χ. 17672" : "Σύνδεσε πρώτα spreadsheet";
  byId<HTMLSelectElement>("appointment-date").disabled = !ready;
  byId<HTMLSelectElement>("appointment-provider").disabled = !ready;
  byId<HTMLButtonElement>("recommend-button").disabled = !ready;
  byId<HTMLButtonElement>("reload-sheets").disabled = !ready;
}

async function fetchSheets(targetSpreadsheetId = spreadsheetId): Promise<void> {
  if (!targetSpreadsheetId) throw new Error("Βάλε πρώτα το link του Google spreadsheet.");
  readCalendarYear();
  setConnection("loading", "Σύνδεση με το spreadsheet…");
  const response = await fetch("/api/sheets?spreadsheetId=" + encodeURIComponent(targetSpreadsheetId) + "&_=" + Date.now(), { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text() || "Δεν ήταν δυνατή η ανάγνωση της λίστας ημερών.");
  const html = await response.text();
  const year = manualCalendarYear ? readCalendarYear() : detectScheduleYear(html);
  const nextSheets = parseSheetTabs(html, year);
  if (!nextSheets.length) throw new Error("Δεν βρέθηκαν φύλλα με ημερομηνία. Έλεγξε ότι το link του spreadsheet είναι προσβάσιμο.");
  const keepPrevious = spreadsheetId === targetSpreadsheetId;
  spreadsheetId = targetSpreadsheetId;
  sheetCatalogHtml = html;
  calendarYear = year;
  byId<HTMLInputElement>("spreadsheet-year").value = String(year);
  sheets = nextSheets;
  populateDateSelect(keepPrevious);
  setSchedulerReady(true);
  showCalendarConnection();
}

function readCalendarYear(): number {
  const year = Number(byId<HTMLInputElement>("spreadsheet-year").value);
  if (!isScheduleYear(year)) throw new Error("Βάλε έγκυρο τετραψήφιο έτος προγράμματος.");
  return year;
}

function showCalendarConnection(): void {
  const years = [...new Set(sheets.map(sheet => sheet.date.slice(0, 4)))].join(" / ");
  setConnection("online", "Live σύνδεση · " + sheets.length + " ημέρες διαθέσιμες · " + years);
}

function changeCalendarYear(automatic = false): void {
  invalidateRecommendation();
  try {
    const year = automatic ? detectScheduleYear(sheetCatalogHtml) : readCalendarYear();
    if (sheetCatalogHtml) {
      const nextSheets = parseSheetTabs(sheetCatalogHtml, year);
      if (!nextSheets.length) throw new Error("Δεν βρέθηκαν έγκυρες ημερομηνίες για το επιλεγμένο έτος.");
      sheets = nextSheets;
      populateDateSelect();
      showCalendarConnection();
    }
    calendarYear = year;
    manualCalendarYear = !automatic;
    byId<HTMLInputElement>("spreadsheet-year").value = String(year);
    showToast("Έτος προγράμματος: " + year + ".");
  } catch (error) {
    byId<HTMLInputElement>("spreadsheet-year").value = String(calendarYear);
    showToast(error instanceof Error ? error.message : "Μη έγκυρο έτος.", "error");
  }
}

function populateDateSelect(keepPrevious = true): void {
  const select = byId<HTMLSelectElement>("appointment-date");
  const previous = keepPrevious ? select.value : "";
  select.replaceChildren();
  for (const sheet of sheets) {
    const option = document.createElement("option");
    option.value = sheet.gid;
    option.textContent = sheet.name + " · " + sheet.date.slice(0, 4);
    option.dataset.date = sheet.date;
    select.append(option);
  }
  const today = todayLocal();
  const preferred = sheets.find((sheet) => sheet.gid === previous) ||
    sheets.find((sheet) => sheet.date === today) ||
    [...sheets].reverse().find((sheet) => sheet.date <= today) ||
    sheets[0];
  select.value = preferred.gid;
}

function setConnection(tone: "idle" | "loading" | "online" | "error", message: string): void {
  const badge = byId<HTMLElement>("connection-status");
  badge.className = "connection connection--" + tone;
  badge.textContent = message;
}

function setLoading(loading: boolean, automatic = false): void {
  const button = byId<HTMLButtonElement>("recommend-button");
  button.disabled = loading || !spreadsheetId || !sheets.length;
  button.textContent = loading ? (automatic ? "Ανανέωση…" : "Έλεγχος…") : "Βρες τεχνικό";
  byId<HTMLElement>("refresh-indicator").textContent = loading ? "Διαβάζω τώρα το live φύλλο…" : "";
}

function selectedSheet(): SheetTab | null {
  const gid = byId<HTMLSelectElement>("appointment-date").value;
  return sheets.find((sheet) => sheet.gid === gid) || null;
}

async function loadLiveSchedule(gid: string): Promise<ParsedSchedule> {
  const sheet = sheets.find((item) => item.gid === gid);
  if (!sheet) throw new Error("Δεν βρέθηκε η επιλεγμένη ημέρα στη λίστα του spreadsheet.");
  const response = await fetch(
    "/api/sheet?spreadsheetId=" + encodeURIComponent(spreadsheetId) + "&gid=" + encodeURIComponent(gid) + "&_=" + Date.now(),
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(await response.text() || "Αποτυχία λήψης του φύλλου.");
  return parseScheduleByName(await response.arrayBuffer(), sheet.name);
}

function currentFormValues(): SearchValues | null {
  const postcode = normalizePostcode(byId<HTMLInputElement>("appointment-postcode").value);
  const gid = byId<HTMLSelectElement>("appointment-date").value;
  const provider = byId<HTMLSelectElement>("appointment-provider").value;
  byId<HTMLInputElement>("appointment-postcode").value = postcode;
  if (postcode.length !== 5 || !gid || Number(byId<HTMLInputElement>("spreadsheet-year").value) !== calendarYear || (provider !== "nova" && provider !== "vodafone")) return null;
  return { postcode, gid, provider, year: calendarYear };
}

function invalidateRecommendation(): void {
  searchRevision += 1;
  lastSubmitted = null;
  lastSchedule = null;
  lastRecommendation = null;
  byId<HTMLElement>("schedule-result").hidden = true;
  byId<HTMLElement>("last-refresh-note").textContent = "";
}

async function performRecommendation(automatic = false): Promise<void> {
  if (refreshInFlight) return;
  const values = automatic ? lastSubmitted : currentFormValues();
  if (!values) {
    if (!automatic) showToast("Έλεγξε τον πενταψήφιο ΤΚ, την ημέρα και το έτος προγράμματος.", "error");
    return;
  }
  if (automatic) {
    const current = currentFormValues();
    if (!current || JSON.stringify(current) !== JSON.stringify(values)) return;
  }
  refreshInFlight = true;
  const revision = searchRevision;
  const sourceId = spreadsheetId;
  const isCurrent = (): boolean => revision === searchRevision && sourceId === spreadsheetId &&
    JSON.stringify(currentFormValues()) === JSON.stringify(values);
  setLoading(true, automatic);
  try {
    const schedule = await loadLiveSchedule(values.gid);
    if (!isCurrent()) return;
    lastSchedule = schedule;
    lastRecommendation = recommendTechnicians(schedule, values.postcode, HISTORY, resolvePostcode, values.provider);
    lastSubmitted = values;
    lastRefresh = new Date();
    renderRecommendation(lastRecommendation, selectedSheet());
    setConnection("online", "Live · τελευταία ανάγνωση " + lastRefresh.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    if (!automatic) byId<HTMLElement>("schedule-result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (!isCurrent()) return;
    const message = error instanceof Error ? error.message : "Άγνωστο σφάλμα ανάγνωσης.";
    setConnection("error", "Δεν έγινε live ενημέρωση");
    renderScheduleError(message);
  } finally {
    refreshInFlight = false;
    setLoading(false);
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function appendList(container: HTMLElement, values: string[], className: string): void {
  if (!values.length) return;
  const list = element("ul", className);
  for (const value of values) list.append(element("li", "", value));
  container.append(list);
}

function providerLabel(provider: "nova" | "vodafone" | "unknown"): string {
  return provider === "nova" ? "NOVA" : provider === "vodafone" ? "Vodafone" : "Άγνωστος πάροχος";
}

function candidateCopyText(candidate: Candidate, result: Recommendation, sheet: SheetTab | null): string {
  return [
    "Πρόταση τεχνικού: " + candidate.technician.name,
    "Ημέρα: " + (sheet ? sheet.name + " · " + sheet.date.split("-").reverse().join("/") : "—"),
    "Πάροχος: " + providerLabel(result.provider),
    "ΤΚ: " + result.postcode,
    "Ώρα: επιλέγεται χειροκίνητα στο spreadsheet",
    "Αιτιολόγηση: " + candidate.reasons.join(" "),
    candidate.warnings.length ? "Προσοχή: " + candidate.warnings.join(" ") : "",
  ].filter(Boolean).join("\n");
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function candidateCard(candidate: Candidate, result: Recommendation, sheet: SheetTab | null, index: number): HTMLElement {
  const card = element("article", "candidate-card" + (index === 0 ? " candidate-card--primary" : ""));
  const heading = element("div", "candidate-card__heading");
  const titleBlock = element("div");
  titleBlock.append(
    element("span", "candidate-rank", index === 0 ? "ΚΥΡΙΑ ΠΡΟΤΑΣΗ" : "ΕΝΑΛΛΑΚΤΙΚΗ " + index),
    element("h3", "", candidate.technician.name),
  );
  const matchLabel = {
    special: "Ρητός κανόνας",
    exact: "Ίδιος ΤΚ",
    direct: "Άμεσο ταίριασμα",
    indirect: "Έμμεσο ταίριασμα",
    history: "Ιστορική επιλογή",
    empty: "Χειροκίνητος έλεγχος",
  }[candidate.match];
  const score = element("span", "score", matchLabel);
  heading.append(titleBlock, score);
  card.append(heading);

  const metrics = element("div", "metrics");
  metrics.append(
    element("span", "metric", candidate.activationCount + (result.provider === "nova" ? "/4" : "") + " FTTH Activation"),
    element("span", "metric", candidate.otherCount + (result.provider === "nova" ? "/6" : "") + " λοιπές"),
    element("span", "metric", "Η ώρα επιλέγεται χειροκίνητα"),
  );
  card.append(metrics);
  appendList(card, candidate.reasons, "reason-list");
  appendList(card, candidate.warnings, "warning-list");

  if (candidate.technician.jobs.length) {
    const route = element("details", "route-details");
    route.append(element("summary", "", "Δρομολόγιο επιλεγμένης ημέρας (" + candidate.technician.jobs.length + ")"));
    const chips = element("div", "route-chips");
    for (const job of candidate.technician.jobs) {
      chips.append(element(
        "span",
        "route-chip route-chip--" + job.provider,
        (job.time || "χωρίς ώρα") + " · " + job.type + (job.postcode ? " · " + job.postcode : "") + " · " + providerLabel(job.provider),
      ));
    }
    route.append(chips);
    card.append(route);
  }

  const actions = element("div", "candidate-actions");
  const open = element("a", "primary-action", "Άνοιγμα στο όνομα του τεχνικού");
  const headerColumn = String.fromCharCode(64 + candidate.technician.headerColumn);
  open.href = "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/edit#gid=" + encodeURIComponent(sheet?.gid || "") + "&range=" + headerColumn + candidate.technician.headerRow;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  const copy = element("button", "secondary-action", "Αντιγραφή πρότασης");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    await copyText(candidateCopyText(candidate, result, sheet));
    showToast("Η πρόταση αντιγράφηκε.");
  });
  actions.append(open, copy);
  card.append(actions);
  return card;
}

function renderRecommendation(result: Recommendation, sheet: SheetTab | null): void {
  const output = byId<HTMLElement>("schedule-result");
  output.replaceChildren();
  output.hidden = false;
  const head = element("div", "result-head");
  const title = element("div");
  title.append(
    element("span", "eyebrow", "LIVE ΑΠΟΤΕΛΕΣΜΑ · " + providerLabel(result.provider)),
    element("h2", "", result.postcode),
    element("p", "muted", (sheet ? sheet.name + " · " + sheet.date.split("-").reverse().join("/") : "") + " · " + (lastSchedule?.technicians.filter((item) => item.red).length || 0) + " κόκκινοι τεχνικοί ελέγχθηκαν"),
  );
  const refresh = element("button", "refresh-button", "Ανανέωση τώρα");
  refresh.type = "button";
  refresh.addEventListener("click", () => void performRecommendation(true));
  head.append(title, refresh);
  output.append(head);

  const manualNote = element("p", "manual-note", "Η εφαρμογή προτείνει τεχνικό βάσει ημέρας και περιοχής. Εσύ επιλέγεις χειροκίνητα την πραγματικά κενή ώρα και ελέγχεις τις σημειώσεις πριν την καταχώριση.");
  output.append(manualNote);
  if (result.provider === "vodafone") {
    output.append(element("p", "muted", "Ελέγχονται οι κόκκινοι τεχνικοί. Οι μετρητές αφορούν όλες τις εργασίες της ημέρας. Δεν εφαρμόζεται το ιστορικό NOVA ούτε όρια φόρτου Vodafone."));
  }

  if (!result.candidates.length) {
    const empty = element("section", "empty-result");
    empty.append(
      element("strong", "", "Δεν βρέθηκε ασφαλής διαθέσιμη πρόταση."),
      element("p", "", "Το app δεν έκανε εικασία. Δοκίμασε άλλη ημέρα ή έλεγξε χειροκίνητα τους αποκλεισμούς παρακάτω."),
    );
    output.append(empty);
  } else {
    const grid = element("div", "candidate-grid");
    result.candidates.slice(0, 3).forEach((candidate, index) => grid.append(candidateCard(candidate, result, sheet, index)));
    output.append(grid);
  }

  const rule = element("details", "rule-details");
  rule.append(element("summary", "", "Κανόνας ΤΚ που χρησιμοποιήθηκε: " + result.rule.group));
  const ruleBody = element("div", "rule-details__body");
  ruleBody.append(
    element("p", "", "Άμεσα: " + (result.rule.direct.join(", ") || "—")),
    element("p", "", "Έμμεσα: " + (result.rule.indirect.join(", ") || "—")),
    element("p", "", "Δεν ταιριάζει: " + (result.rule.excluded.join(", ") || "—")),
  );
  rule.append(ruleBody);
  output.append(rule);

  if (result.rejected.length) {
    const rejected = element("details", "rejected-details");
    rejected.append(element("summary", "", "Γιατί αποκλείστηκαν άλλοι τεχνικοί (" + result.rejected.length + ")"));
    const list = element("div", "rejected-list");
    for (const candidate of result.rejected.slice(0, 20)) {
      const item = element("div", "rejected-item");
      item.append(element("strong", "", candidate.technician.name), element("span", "", candidate.blockers.join(" ")));
      list.append(item);
    }
    rejected.append(list);
    output.append(rejected);
  }
  byId<HTMLElement>("last-refresh-note").textContent = "Αυτόματη επανάληψη κάθε 60″ όσο παραμένει αυτό το αποτέλεσμα ανοιχτό.";
}

function renderScheduleError(message: string): void {
  const output = byId<HTMLElement>("schedule-result");
  output.replaceChildren();
  output.hidden = false;
  const card = element("section", "error-result");
  card.append(element("strong", "", "Δεν μπόρεσα να διαβάσω το live spreadsheet."), element("p", "", message));
  output.append(card);
}

function renderTkResult(result: SearchResult): void {
  const output = byId<HTMLElement>("tk-result");
  output.replaceChildren();
  output.hidden = false;
  const head = element("div", "tk-result__head");
  const title = element("div");
  title.append(element("span", "eyebrow", "ΑΠΟΤΕΛΕΣΜΑ ΓΙΑ"), element("h2", "", result.postcode), element("p", "muted", result.group));
  const copy = element("button", "secondary-action", "Αντιγραφή όλων");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    await copyText([
      "ΤΚ " + result.postcode,
      "Κανόνας: " + result.group,
      "Άμεσα: " + (result.direct.join(", ") || "—"),
      "Έμμεσα / εναλλακτικά: " + (result.indirect.join(", ") || "—"),
      "Δεν ταιριάζει: " + (result.excluded.join(", ") || "—"),
      "Σημείωση: " + result.note,
    ].join("\n"));
    showToast("Αντιγράφηκε όλο το αποτέλεσμα.");
  });
  head.append(title, copy);
  output.append(head);
  const columns = element("div", "tk-columns");
  for (const [tone, label, values] of [
    ["direct", "Άμεσα", result.direct],
    ["indirect", "Έμμεσα / εναλλακτικά", result.indirect],
    ["excluded", "Δεν ταιριάζει", result.excluded],
  ] as const) {
    const section = element("section", "tk-column tk-column--" + tone);
    section.append(element("h3", "", label));
    const chips = element("div", "tk-chips");
    (values.length ? values : ["—"]).forEach((value) => chips.append(element("span", "tk-chip", value)));
    section.append(chips);
    columns.append(section);
  }
  output.append(columns, element("p", "tk-note", result.note));
}

function normalizeImportedRule(raw: Record<string, unknown>): ImportedRule {
  const match = normalizePattern(String(raw.match || ""));
  if (!/^1[\dx]{4}$/.test(match) && !/^(1\d{4})-(1\d{4})$/.test(match)) throw new Error("Μη έγκυρο match: " + match);
  const status = String(raw.status || "confirmed") as ResultStatus;
  if (!["confirmed", "trend", "unknown"].includes(status)) throw new Error("Μη έγκυρο status στο " + match);
  const list = (value: unknown): string[] => Array.isArray(value) ? unique(value.map(String)) : [];
  return {
    match,
    group: String(raw.group || "Τοπική ενημέρωση").trim(),
    status,
    confidence: String(raw.confidence || "Τοπική ενημέρωση").trim(),
    direct: list(raw.direct),
    indirect: list(raw.indirect),
    excluded: list(raw.excluded),
    note: String(raw.note || "Τοπική ενημέρωση.").trim(),
    bidirectional: raw.bidirectional === true,
    priority: Math.trunc(Number(raw.priority || 0)),
  };
}

async function importUpdate(file: File): Promise<void> {
  if (file.size > 2 * 1024 * 1024) throw new Error("Το αρχείο είναι μεγαλύτερο από 2 MB.");
  const raw = JSON.parse((await file.text()).replace(/^\uFEFF/, "")) as Record<string, unknown>;
  if (raw.schema !== "satpraxis-tk-update" || Number(raw.schemaVersion) !== 1 || !Array.isArray(raw.rules)) {
    throw new Error("Το JSON δεν ακολουθεί το schema satpraxis-tk-update έκδοση 1.");
  }
  const mode = raw.mode === "replace" ? "replace" : "merge";
  const map = new Map<string, ImportedRule>();
  if (mode === "merge") storedUpdate.rules.forEach((rule) => map.set(rule.match, rule));
  const remove = Array.isArray(raw.remove) ? raw.remove.map((item) => normalizePattern(String(item))) : [];
  remove.forEach((match) => map.delete(match));
  raw.rules.map((item) => normalizeImportedRule(item as Record<string, unknown>)).forEach((rule) => map.set(rule.match, rule));
  storedUpdate = {
    dataVersion: String(raw.dataVersion || new Date().toISOString().slice(0, 10)),
    sourceFile: file.name,
    storedAt: new Date().toISOString(),
    rules: [...map.values()],
  };
  localStorage.setItem(UPDATE_STORAGE_KEY, JSON.stringify(storedUpdate));
  updateTkDataStatus();
  showToast("Η ενημέρωση εφαρμόστηκε: " + storedUpdate.rules.length + " ενεργοί κανόνες.");
}

function updateTkDataStatus(): void {
  byId<HTMLElement>("tk-data-status").textContent = storedUpdate.rules.length
    ? "Ενσωματωμένη βάση 06/09/2026 + " + storedUpdate.rules.length + " κανόνες ενημέρωσης " + storedUpdate.dataVersion
    : "Ενσωματωμένη βάση ΤΚ 06/09/2026";
}

function showToast(message: string, tone: "normal" | "error" = "normal"): void {
  const toast = byId<HTMLElement>("toast");
  toast.textContent = message;
  toast.className = "toast toast--visible" + (tone === "error" ? " toast--error" : "");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 3000);
}

function switchView(view: "schedule" | "tk"): void {
  byId<HTMLElement>("schedule-view").hidden = view !== "schedule";
  byId<HTMLElement>("tk-view").hidden = view !== "tk";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    const selected = button.dataset.view === view;
    button.classList.toggle("tab-button--active", selected);
    button.setAttribute("aria-selected", String(selected));
  }
}

function setup(): void {
  try { localStorage.removeItem("satpraxis-scheduler-sheet-v1"); } catch { }
  byId<HTMLInputElement>("spreadsheet-url").value = "";
  byId<HTMLInputElement>("spreadsheet-year").value = String(calendarYear);
  setSchedulerReady(false);
  setConnection("idle", "Δεν έχει επιλεγεί spreadsheet");
  updateTkDataStatus();
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view as "schedule" | "tk"));
  });
  byId<HTMLFormElement>("appointment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void performRecommendation(false);
  });
  byId<HTMLSelectElement>("appointment-provider").addEventListener("change", invalidateRecommendation);
  byId<HTMLSelectElement>("appointment-date").addEventListener("change", invalidateRecommendation);
  byId<HTMLInputElement>("appointment-postcode").addEventListener("input", invalidateRecommendation);
  byId<HTMLInputElement>("spreadsheet-year").addEventListener("input", invalidateRecommendation);
  byId<HTMLInputElement>("spreadsheet-year").addEventListener("change", () => changeCalendarYear());
  byId<HTMLButtonElement>("detect-year").addEventListener("click", () => changeCalendarYear(true));
  byId<HTMLButtonElement>("reload-sheets").addEventListener("click", async () => {
    invalidateRecommendation();
    try {
      await fetchSheets();
      showToast("Η λίστα ημερών ανανεώθηκε.");
    } catch (error) {
      setConnection("error", error instanceof Error ? error.message : "Σφάλμα σύνδεσης");
    }
  });
  byId<HTMLButtonElement>("save-spreadsheet").addEventListener("click", async () => {
    const id = extractSpreadsheetId(byId<HTMLInputElement>("spreadsheet-url").value);
    if (!id) {
      showToast("Βάλε έγκυρο Google Sheets link.", "error");
      return;
    }
    const hadConnection = Boolean(spreadsheetId && sheets.length);
    setSchedulerReady(false);
    invalidateRecommendation();
    try {
      await fetchSheets(id);
      byId<HTMLDetailsElement>("spreadsheet-settings").open = false;
      showToast("Το spreadsheet συνδέθηκε για αυτή την εκκίνηση.");
    } catch (error) {
      setSchedulerReady(hadConnection);
      setConnection("error", error instanceof Error ? error.message : "Σφάλμα σύνδεσης");
    }
  });
  byId<HTMLFormElement>("tk-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = byId<HTMLInputElement>("tk-postcode");
    input.value = normalizePostcode(input.value);
    if (input.value.length === 5) renderTkResult(resolvePostcode(input.value));
  });
  byId<HTMLButtonElement>("import-update").addEventListener("click", () => byId<HTMLInputElement>("update-file").click());
  byId<HTMLInputElement>("update-file").addEventListener("change", async (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await importUpdate(file);
      const postcode = normalizePostcode(byId<HTMLInputElement>("tk-postcode").value);
      if (postcode.length === 5) renderTkResult(resolvePostcode(postcode));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Μη έγκυρη ενημέρωση.", "error");
    } finally {
      (event.currentTarget as HTMLInputElement).value = "";
    }
  });
  setInterval(() => void performRecommendation(true), REFRESH_INTERVAL);
}

setup();

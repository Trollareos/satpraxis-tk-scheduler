export type SheetTab = {
  name: string;
  gid: string;
  date: string;
};

export function extractSpreadsheetId(value: string): string | null {
  const match = value.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/) || value.trim().match(/^([A-Za-z0-9_-]{20,100})$/);
  return match ? match[1] : null;
}

type DateParts = { day: number; month: number; year: number | null };
type DatedTab = { name: string; gid: string; parts: DateParts; yearOffset: number };

export function isScheduleYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1000 && year <= 9999;
}

function expandYear(value: string, referenceYear: number): number {
  if (value.length === 4) return Number(value);
  const century = Math.floor(referenceYear / 100) * 100;
  return [century - 100, century, century + 100]
    .map(base => base + Number(value))
    .filter(isScheduleYear)
    .sort((a, b) => Math.abs(a - referenceYear) - Math.abs(b - referenceYear) || b - a)[0];
}

function parseDateParts(name: string, referenceYear: number): DateParts | null {
  const clean = name.replace(/\\\//g, "/");
  const iso = clean.match(/(?:^|\s)(\d{4})-(\d{1,2})-(\d{1,2})(?=$|\s|\))/);
  const date = clean.match(/(?:^|\s)(\d{1,2})[.,/-](\d{1,2})(?:[.,/-](\d{4}|\d{2})|\s+(\d{4}))?(?=$|\s|\))/);
  const compact = clean.match(/(?:^|\s)(\d{1,2})(\d{2})(?=$|\s|\))/);
  const match = iso || date || compact;
  if (!match) return null;
  const day = Number(iso ? match[3] : match[1]);
  const month = Number(match[2]);
  const rawYear = iso ? match[1] : date ? match[3] || match[4] : "";
  const year = rawYear ? expandYear(rawYear, referenceYear) : null;
  const maxDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > maxDays[month - 1] || (year !== null && !isScheduleYear(year))) return null;
  return { day, month, year };
}

function datedTabs(html: string, referenceYear: number): DatedTab[] {
  const result: DatedTab[] = [];
  let previousMonth = 0;
  let yearOffset = 0;
  for (const item of html.matchAll(/items\.push\(\{name:\s*"((?:\\.|[^"\\])*)"[\s\S]*?gid:\s*"(\d+)"/g)) {
    let name: string;
    try { name = JSON.parse('"' + item[1] + '"'); }
    catch { name = item[1].replace(/\\\//g, "/").replace(/\\"/g, '"'); }
    const parts = parseDateParts(name, referenceYear);
    if (!parts) continue;
    // Undated years follow the workbook's tab order through a winter rollover.
    if (previousMonth >= 10 && parts.month <= 3) yearOffset += 1;
    previousMonth = parts.month;
    result.push({ name, gid: item[2], parts, yearOffset });
  }
  return result;
}

function titleCalendar(html: string, referenceYear: number): { year: number; month: number | null } | null {
  const title = (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, decimal) => {
      const code = parseInt(hex || decimal, hex ? 16 : 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&nbsp;/gi, " ").replace(/&(?:amp|quot|apos);/gi, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const months = [
    "ΙΑΝΟΥΑΡΙΟΣ|ΙΑΝΟΥΑΡΙΟΥ|JANUARY", "ΦΕΒΡΟΥΑΡΙΟΣ|ΦΕΒΡΟΥΑΡΙΟΥ|FEBRUARY",
    "ΜΑΡΤΙΟΣ|ΜΑΡΤΙΟΥ|MARCH", "ΑΠΡΙΛΙΟΣ|ΑΠΡΙΛΙΟΥ|APRIL", "ΜΑΙΟΣ|ΜΑΙΟΥ|MAY",
    "ΙΟΥΝΙΟΣ|ΙΟΥΝΙΟΥ|JUNE", "ΙΟΥΛΙΟΣ|ΙΟΥΛΙΟΥ|JULY", "ΑΥΓΟΥΣΤΟΣ|ΑΥΓΟΥΣΤΟΥ|AUGUST",
    "ΣΕΠΤΕΜΒΡΙΟΣ|ΣΕΠΤΕΜΒΡΙΟΥ|SEPTEMBER", "ΟΚΤΩΒΡΙΟΣ|ΟΚΤΩΒΡΙΟΥ|OCTOBER",
    "ΝΟΕΜΒΡΙΟΣ|ΝΟΕΜΒΡΙΟΥ|NOVEMBER", "ΔΕΚΕΜΒΡΙΟΣ|ΔΕΚΕΜΒΡΙΟΥ|DECEMBER",
  ];
  for (let index = 0; index < months.length; index += 1) {
    const match = title.match(new RegExp("(?:" + months[index] + ")[\\s_/-]+(\\d{4}|\\d{2})(?!\\d)"));
    if (match) return { year: expandYear(match[1], referenceYear), month: index + 1 };
  }
  const years = [...new Set([...title.matchAll(/(?<!\d)([1-9]\d{3})(?!\d)/g)].map(match => Number(match[1])))];
  return years.length === 1 ? { year: years[0], month: null } : null;
}

export function detectScheduleYear(html: string, referenceYear = new Date().getFullYear()): number {
  const tabs = datedTabs(html, referenceYear);
  const explicit = tabs.find(tab => tab.parts.year !== null);
  if (explicit) return explicit.parts.year! - explicit.yearOffset;
  const title = titleCalendar(html, referenceYear);
  if (!title) return referenceYear;
  const previousDecember = title.month !== null && title.month <= 3 && tabs[0]?.parts.month >= 10 && tabs.some(tab => tab.yearOffset > 0);
  return title.year - (previousDecember ? 1 : 0);
}

export function parseSheetTabs(html: string, baseYear = new Date().getFullYear()): SheetTab[] {
  if (!isScheduleYear(baseYear)) throw new Error("Το έτος προγράμματος πρέπει να έχει τέσσερα ψηφία.");
  const tabs = datedTabs(html, baseYear);
  const explicit = tabs.find(tab => tab.parts.year !== null);
  let year = explicit ? explicit.parts.year! - explicit.yearOffset : baseYear;
  let previousOffset = 0;
  const result: SheetTab[] = [];
  for (const tab of tabs) {
    year += tab.yearOffset - previousOffset;
    previousOffset = tab.yearOffset;
    if (tab.parts.year !== null) year = tab.parts.year;
    if (!isScheduleYear(year)) continue;
    const { day, month } = tab.parts;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
    result.push({ name: tab.name, gid: tab.gid, date: year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0") });
  }
  return result.sort((first, second) => first.date.localeCompare(second.date));
}

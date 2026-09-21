export type SheetTab = {
  name: string;
  gid: string;
  date: string;
};

export function extractSpreadsheetId(value: string): string | null {
  const match = value.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/) || value.trim().match(/^([A-Za-z0-9_-]{20,100})$/);
  return match ? match[1] : null;
}

function parseSheetDate(name: string): string | null {
  const clean = name.replace(/\\\//g, "/");
  const match = clean.match(/(?:^|\s)(\d{1,2})[./-](\d{1,2})(?:\s|$)/) ||
    clean.match(/(?:^|\s)(\d{1,2})(\d{2})(?:\s|$)/);
  if (!match) return null;
  return "2026-" + String(Number(match[2])).padStart(2, "0") + "-" + String(Number(match[1])).padStart(2, "0");
}

export function parseSheetTabs(html: string): SheetTab[] {
  const result: SheetTab[] = [];
  for (const item of html.matchAll(/items\.push\(\{name:\s*"([^"]+)"[\s\S]*?gid:\s*"(\d+)"/g)) {
    const name = item[1].replace(/\\\//g, "/").replace(/\\"/g, '"');
    const date = parseSheetDate(name);
    if (date) result.push({ name, gid: item[2], date });
  }
  return result.sort((first, second) => first.date.localeCompare(second.date));
}

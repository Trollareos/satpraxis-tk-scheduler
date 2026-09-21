import { unzipSync } from "fflate";

export type WorkbookSheet = {
  name: string;
  path: string;
};

export type JobProvider = "nova" | "vodafone" | "unknown";

export type ScheduleJob = {
  row: number;
  time: string | null;
  minutes: number | null;
  type: string;
  postcode: string | null;
  workOrder: string | null;
  provider: JobProvider;
  green: boolean;
};

export type TechnicianDay = {
  name: string;
  canonicalName: string;
  headerRow: number;
  headerColumn: number;
  red: boolean;
  jobs: ScheduleJob[];
};

export type ParsedSchedule = {
  sheetName: string;
  technicians: TechnicianDay[];
};

type Cell = {
  row: number;
  col: number;
  style: number;
  value: string;
  fill: string;
};

type WorkbookParts = {
  files: Record<string, Uint8Array>;
  strings: string[];
  fillsByStyle: string[];
  sheets: WorkbookSheet[];
};

const decoder = new TextDecoder("utf-8");

function xml(files: Record<string, Uint8Array>, path: string): string {
  const data = files[path.replace(/^\//, "")];
  if (!data) throw new Error("Λείπει το αρχείο " + path + " από το XLSX.");
  return decoder.decode(data);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function attr(source: string, name: string): string {
  const match = source.match(new RegExp("(?:^|\\s)" + name + '="([^"]*)"'));
  return match ? decodeEntities(match[1]) : "";
}

function columnNumber(reference: string): number {
  const match = reference.match(/^([A-Z]+)/i);
  if (!match) return 0;
  let number = 0;
  for (const char of match[1].toUpperCase()) number = number * 26 + char.charCodeAt(0) - 64;
  return number;
}

function normalizePath(target: string): string {
  const clean = target.replace(/^\//, "");
  return clean.startsWith("xl/") ? clean : "xl/" + clean.replace(/^\.\//, "");
}

function parseSharedStrings(files: Record<string, Uint8Array>): string[] {
  if (!files["xl/sharedStrings.xml"]) return [];
  const source = xml(files, "xl/sharedStrings.xml");
  const values: string[] = [];
  for (const match of source.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
    let value = "";
    for (const text of match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
      value += decodeEntities(text[1]);
    }
    values.push(value);
  }
  return values;
}

function parseThemeColors(files: Record<string, Uint8Array>): string[] {
  const path = Object.keys(files).find((value) => /^xl\/theme\/theme\d+\.xml$/i.test(value));
  if (!path) return [];
  const source = xml(files, path);
  const names = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  return names.map((name) => {
    const block = source.match(new RegExp(`<a:${name}\\b[^>]*>([\\s\\S]*?)<\\/a:${name}>`, "i"))?.[1] || "";
    const rgb = block.match(/<a:srgbClr\b[^>]*\bval="([0-9a-f]{6})"/i)?.[1];
    const system = block.match(/<a:sysClr\b[^>]*\blastClr="([0-9a-f]{6})"/i)?.[1];
    const value = (rgb || system || "").toUpperCase();
    return value ? "FF" + value : "";
  });
}

function applyTint(rgb: string, tint: number): string {
  if (!rgb || !Number.isFinite(tint) || tint === 0) return rgb;
  const [red, green, blue] = rgbChannels(rgb);
  const transform = (channel: number): number => Math.max(0, Math.min(255, Math.round(
    tint < 0 ? channel * (1 + tint) : channel * (1 - tint) + 255 * tint,
  )));
  return "FF" + [transform(red), transform(green), transform(blue)]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function colorFromFill(fillXml: string, themeColors: string[]): string {
  const foreground = fillXml.match(/<fgColor\b([^>]*)\/?\s*>/);
  if (!foreground) return "";
  const rgb = attr(foreground[1], "rgb").toUpperCase();
  if (rgb) return rgb.length === 6 ? "FF" + rgb : rgb;
  const theme = attr(foreground[1], "theme");
  if (theme !== "") {
    const base = themeColors[Number(theme)] || "";
    const tint = Number(attr(foreground[1], "tint") || 0);
    return applyTint(base, tint);
  }
  const indexed = attr(foreground[1], "indexed");
  const indexedColors: Record<string, string> = {
    "3": "FFFF0000",
    "10": "FFFF0000",
    "11": "FF00FF00",
  };
  return indexedColors[indexed] || "";
}

function parseStyleFills(files: Record<string, Uint8Array>, themeColors: string[]): string[] {
  if (!files["xl/styles.xml"]) return [""];
  const source = xml(files, "xl/styles.xml");
  const fillsBlock = source.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/)?.[1] || "";
  const fills = [...fillsBlock.matchAll(/<fill(?:\s[^>]*)?>([\s\S]*?)<\/fill>/g)].map((item) =>
    colorFromFill(item[1], themeColors),
  );
  const xfsBlock = source.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || "";
  return [...xfsBlock.matchAll(/<xf\b([^>]*)\/?\s*>/g)].map((item) => {
    const fillId = Number(attr(item[1], "fillId") || 0);
    return fills[fillId] || "";
  });
}

function parseWorkbookSheets(files: Record<string, Uint8Array>): WorkbookSheet[] {
  const workbook = xml(files, "xl/workbook.xml");
  const relationships = xml(files, "xl/_rels/workbook.xml.rels");
  const targets = new Map<string, string>();
  for (const relationship of relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    targets.set(attr(relationship[1], "Id"), normalizePath(attr(relationship[1], "Target")));
  }
  const result: WorkbookSheet[] = [];
  for (const sheet of workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const attributes = sheet[1];
    const id = attr(attributes, "r:id");
    const path = targets.get(id);
    if (path) result.push({ name: attr(attributes, "name"), path });
  }
  return result;
}

export function openWorkbook(data: Uint8Array | ArrayBuffer): WorkbookParts {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Το αρχείο που επέστρεψε το spreadsheet δεν είναι έγκυρο XLSX.");
  }
  const themeColors = parseThemeColors(files);
  return {
    files,
    strings: parseSharedStrings(files),
    fillsByStyle: parseStyleFills(files, themeColors),
    sheets: parseWorkbookSheets(files),
  };
}

function readCellValue(body: string, type: string, strings: string[]): string {
  if (type === "inlineStr") {
    return [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((item) => decodeEntities(item[1]))
      .join("");
  }
  const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] || "";
  if (type === "s" && raw !== "") return strings[Number(raw)] || "";
  return decodeEntities(raw);
}

function parseCells(sheetXml: string, strings: string[], fillsByStyle: string[]): Cell[] {
  const cells: Cell[] = [];
  const expression = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  for (const match of sheetXml.matchAll(expression)) {
    const attributes = match[1] || match[2] || "";
    const reference = attr(attributes, "r");
    const row = Number(reference.match(/(\d+)$/)?.[1] || 0);
    const col = columnNumber(reference);
    if (!row || !col) continue;
    const style = Number(attr(attributes, "s") || 0);
    const value = match[3] ? readCellValue(match[3], attr(attributes, "t"), strings) : "";
    cells.push({ row, col, style, value, fill: fillsByStyle[style] || "" });
  }
  return cells;
}

function mergedHeaderRows(sheetXml: string): Map<number, number> {
  const rows = new Map<number, number>();
  for (const merge of sheetXml.matchAll(/<mergeCell\b([^>]*)\/?\s*>/g)) {
    const reference = attr(merge[1], "ref");
    const parts = reference.split(":");
    if (parts.length !== 2) continue;
    const firstRow = Number(parts[0].match(/(\d+)$/)?.[1] || 0);
    const lastRow = Number(parts[1].match(/(\d+)$/)?.[1] || 0);
    const firstCol = columnNumber(parts[0]);
    const lastCol = columnNumber(parts[1]);
    if (firstRow === lastRow && firstCol >= 2 && firstCol <= 3 && lastCol - firstCol >= 15) rows.set(firstRow, firstCol);
  }
  return rows;
}

function rgbChannels(value: string): [number, number, number] {
  const clean = value.replace(/^FF/, "").slice(-6);
  if (!/^[0-9A-F]{6}$/i.test(clean)) return [0, 0, 0];
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4), 16)];
}

export function isRedFill(fill: string): boolean {
  const [red, green, blue] = rgbChannels(fill);
  return red >= 220 && green <= 85 && blue <= 85;
}

export function isGreenFill(fill: string): boolean {
  const [red, green, blue] = rgbChannels(fill);
  return green >= 120 && green > red * 1.18 && green > blue * 1.12;
}

export function normalizeGreek(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[¨΅]/g, ":")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalTechnicianName(value: string): string {
  return normalizeGreek(value)
    .replace(/[()]/g, " ")
    .replace(/(?:^|\s)(?:ΕΚΤΟΣ|EKTOS|ΑΔΕΙΑ|ΟΧΙ\s+ΑΛΛ(?:Ο|Α)|ΝΑ\s+ΜΗΝ\s+ΑΛΛΑΞΕΙ)(?:\s|$).*$/u, "")
    .replace(/(?:^|\s)(?:ΜΕΧΡΙ|ΕΩΣ)\s*\d{1,2}(?::|[.,])?\d{0,2}.*$/u, "")
    .replace(/(?:^|\s)\d{1,2}(?::|[.,])\d{2}\s*-\s*\d{1,2}(?::|[.,])\d{2}.*$/u, "")
    .replace(/(?:^|\s)(?:VODAFONE|ΒΟΝΤΑΦΟΝ|ΒΟΝΤΑ|VF)(?:\s|$).*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function serialTime(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value >= 1) return null;
  return Math.round((value * 24 * 60) / 30) * 30;
}

export function parseTime(value: string): { text: string; minutes: number } | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const number = Number(raw.replace(",", "."));
  const fromSerial = serialTime(number);
  if (fromSerial !== null) {
    const hours = Math.floor(fromSerial / 60) % 24;
    const minutes = fromSerial % 60;
    return { text: String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0"), minutes: fromSerial };
  }
  const normalized = raw.replace(/[¨΅.]/g, ":").replace(/\s+/g, "");
  const match = normalized.match(/^(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  if (hours > 23 || minutes > 59) return null;
  return {
    text: String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0"),
    minutes: hours * 60 + minutes,
  };
}

function postcode(value: string): string | null {
  const match = String(value || "").match(/(?<!\d)(1\d{4})(?:\.0)?(?!\d)/);
  return match ? match[1] : null;
}

function workOrder(value: string): string | null {
  const normalized = String(value || "").replace(/\s+/g, "").trim();
  return normalized || null;
}

export function providerFromWorkOrder(value: string | null): JobProvider {
  const normalized = String(value || "").replace(/\s+/g, "").toUpperCase();
  if (/^(?:PS|TAS)/.test(normalized)) return "nova";
  if (/^(?:1-|VOD|VFS|VF)/.test(normalized)) return "vodafone";
  return "unknown";
}

function isColumnHeaderRow(timeValue: string, typeValue: string): boolean {
  const time = normalizeGreek(timeValue);
  const type = normalizeGreek(typeValue);
  return time.includes("ΩΡ") && type === "ΕΡΓΑΣΙΑ";
}

export function parseScheduleSheet(parts: WorkbookParts, sheet: WorkbookSheet): ParsedSchedule {
  const source = xml(parts.files, sheet.path);
  const cells = parseCells(source, parts.strings, parts.fillsByStyle);
  const rows = new Map<number, Map<number, Cell>>();
  for (const cell of cells) {
    if (!rows.has(cell.row)) rows.set(cell.row, new Map());
    rows.get(cell.row)!.set(cell.col, cell);
  }
  const headerRows = [...mergedHeaderRows(source)]
    .filter(([row, col]) => Boolean(rows.get(row)?.get(col)?.value.trim()))
    .sort(([first], [second]) => first - second);
  const technicians: TechnicianDay[] = [];
  for (let index = 0; index < headerRows.length; index += 1) {
    const [headerRow, headerColumn] = headerRows[index];
    const end = headerRows[index + 1]?.[0] || Number.MAX_SAFE_INTEGER;
    const headerCell = rows.get(headerRow)!.get(headerColumn)!;
    const jobs: ScheduleJob[] = [];
    const timeColumn = headerColumn;
    const typeColumn = headerColumn + 1;
    const postcodeColumn = headerColumn + 7;
    const workOrderColumn = headerColumn + 16;
    let inheritedType = "";
    let previousJobRow = 0;
    const blockRows = [...rows]
      .filter(([rowNumber]) => rowNumber > headerRow && rowNumber < end)
      .sort(([first], [second]) => first - second);
    for (const [rowNumber, row] of blockRows) {
      if (rowNumber <= headerRow || rowNumber >= end) continue;
      const rawTime = String(row.get(timeColumn)?.value || "").trim();
      const rawType = String(row.get(typeColumn)?.value || "").trim();
      if (isColumnHeaderRow(rawTime, rawType)) {
        inheritedType = "";
        previousJobRow = 0;
        continue;
      }
      const parsedPostcode = postcode(row.get(postcodeColumn)?.value || "");
      const parsedWorkOrder = workOrder(row.get(workOrderColumn)?.value || "");
      const otherContent = [...row.values()].some((cell) =>
        cell.col >= typeColumn && cell.col <= workOrderColumn && String(cell.value || "").trim() !== "",
      );
      if (!rawType && !parsedPostcode && !parsedWorkOrder && !otherContent) {
        inheritedType = "";
        previousJobRow = 0;
        continue;
      }
      const type = rawType || (previousJobRow === rowNumber - 1 ? inheritedType : "") || "Εργασία";
      const parsedTime = parseTime(rawTime);
      const greenCells = [...row.values()].filter((cell) => cell.col >= headerColumn && cell.col <= workOrderColumn && isGreenFill(cell.fill));
      const green = greenCells.length >= 3 || isGreenFill(row.get(typeColumn)?.fill || "");
      const explicitProvider = providerFromWorkOrder(parsedWorkOrder);
      jobs.push({
        row: rowNumber,
        time: parsedTime?.text || null,
        minutes: parsedTime?.minutes ?? null,
        type,
        postcode: parsedPostcode,
        workOrder: parsedWorkOrder,
        provider: explicitProvider === "unknown" && green ? "vodafone" : explicitProvider,
        green,
      });
      inheritedType = type;
      previousJobRow = rowNumber;
    }
    technicians.push({
      name: headerCell.value.trim(),
      canonicalName: canonicalTechnicianName(headerCell.value),
      headerRow,
      headerColumn,
      red: isRedFill(headerCell.fill),
      jobs,
    });
  }
  return { sheetName: sheet.name, technicians };
}

export function parseSingleSchedule(data: Uint8Array | ArrayBuffer): ParsedSchedule {
  const parts = openWorkbook(data);
  if (!parts.sheets.length) throw new Error("Το XLSX δεν περιέχει φύλλο εργασίας.");
  return parseScheduleSheet(parts, parts.sheets[0]);
}

function canonicalSheetName(value: string): string {
  return normalizeGreek(value).replace(/[^0-9A-ZΑ-Ω]+/g, "");
}

export function parseScheduleByName(data: Uint8Array | ArrayBuffer, requestedName: string): ParsedSchedule {
  const parts = openWorkbook(data);
  if (!parts.sheets.length) throw new Error("Το XLSX δεν περιέχει φύλλο εργασίας.");
  const requested = canonicalSheetName(requestedName);
  const sheet = parts.sheets.find((item) => item.name === requestedName) ||
    parts.sheets.find((item) => canonicalSheetName(item.name) === requested);
  if (!sheet) throw new Error("Δεν βρέθηκε το επιλεγμένο φύλλο " + requestedName + " μέσα στο XLSX.");
  return parseScheduleSheet(parts, sheet);
}

export function workbookSheetCatalog(data: Uint8Array | ArrayBuffer): WorkbookSheet[] {
  return openWorkbook(data).sheets;
}

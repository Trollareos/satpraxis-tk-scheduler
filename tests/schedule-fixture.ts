import { strToU8, zipSync } from "fflate";

// Synthetic schedule: no customer details or production workbook contents.
export function scheduleFixture(names = ["ΠΕΜ 1,10", "ΠΑΡ 2,10"]): Uint8Array {
  const cell = (reference: string, value: string, style = 0) => `<c r="${reference}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const technicians = [
    { name: "NOVA ΤΕΧΝΙΚΟΣ", red: true, jobs: [{ code: "PS-TEST", postcode: "17672", green: false }] },
    { name: "VODAFONE ΤΕΧΝΙΚΟΣ", red: true, jobs: [{ code: "1-TEST", postcode: "17672", green: false }] },
    { name: "ΜΙΚΤΟΣ ΤΕΧΝΙΚΟΣ", red: true, jobs: [{ code: "TAS-TEST", postcode: "17672", green: true }, { code: "VFS-TEST", postcode: "17121", green: true }] },
    { name: "ΚΕΝΟΣ ΤΕΧΝΙΚΟΣ", red: true, jobs: [] },
    { name: "ΜΗ ΚΟΚΚΙΝΟΣ", red: false, jobs: [{ code: "VF-TEST", postcode: "17672", green: true }] },
    { name: "ΠΡΑΣΙΝΟΣ ΧΩΡΙΣ ΚΩΔΙΚΟ", red: true, jobs: [{ code: "", postcode: "17672", green: true }] },
    { name: "ΑΓΝΩΣΤΟΣ", red: true, jobs: [{ code: "OTHER-TEST", postcode: "17672", green: false }] },
  ];
  const rows: string[] = [];
  const merges: string[] = [];
  technicians.forEach((technician, index) => {
    const header = index * 10 + 1;
    rows.push(`<row r="${header}">${cell(`C${header}`, technician.name, technician.red ? 1 : 0)}</row>`);
    merges.push(`<mergeCell ref="C${header}:S${header}"/>`);
    technician.jobs.forEach((job, i) => {
      const row = header + i + 1;
      rows.push(`<row r="${row}">${cell(`C${row}`, "09:00")}${cell(`D${row}`, "FTTH Activation", job.green ? 2 : 0)}${cell(`J${row}`, job.postcode)}${cell(`S${row}`, job.code)}</row>`);
    });
  });
  const worksheet = `<worksheet><sheetData>${rows.join("")}</sheetData><mergeCells>${merges.join("")}</mergeCells></worksheet>`;
  return zipSync(Object.fromEntries(Object.entries({
    "xl/workbook.xml": `<workbook><sheets><sheet name="${names[0]}" r:id="rId1"/><sheet name="${names[1]}" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/styles.xml": '<styleSheet><fills><fill><patternFill/></fill><fill><patternFill><fgColor rgb="FFFF0000"/></patternFill></fill><fill><patternFill><fgColor rgb="FF00FF00"/></patternFill></fill></fills><cellXfs><xf fillId="0"/><xf fillId="1"/><xf fillId="2"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": worksheet,
    "xl/worksheets/sheet2.xml": worksheet,
  }).map(([name, content]) => [name, strToU8(content)])));
}

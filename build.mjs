import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = import.meta.dirname;
const output = resolve(root, "dist/Satpraxis_TK_Scheduler_Test_v7");
await build({
  entryPoints: [resolve(root, "src/app.ts")],
  outfile: resolve(root, "build/app.js"),
  bundle: true, platform: "browser", format: "iife", target: "es2020", logLevel: "info",
});
const [template, style, script] = await Promise.all([
  readFile(resolve(root, "src/template.html"), "utf8"),
  readFile(resolve(root, "src/styles.css"), "utf8"),
  readFile(resolve(root, "build/app.js"), "utf8"),
]);
if (!template.includes("%%STYLE%%") || !template.includes("%%SCRIPT%%")) throw new Error("Missing HTML build placeholder.");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "Satpraxis_TK_Scheduler_Test.html"), template.replace("%%STYLE%%", () => style).replace("%%SCRIPT%%", () => script), "utf8");
for (const file of ["server.ps1", "Start_Satpraxis_Scheduler_Test.bat", "ΟΔΗΓΙΕΣ.txt", "Satpraxis_TK_Update_Template.json"]) {
  await copyFile(resolve(root, file), resolve(output, file));
}
console.log(`Ready: ${output}`);

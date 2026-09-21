import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".test-build");
await mkdir(output, { recursive: true });
try {
  for (const name of ["tk-data.test", "rules-test", "family-separation-test"]) {
    const outfile = resolve(output, `${name}.mjs`);
    await build({ entryPoints: [resolve(root, "tests", `${name}.ts`)], outfile, bundle: true, platform: "node", format: "esm", target: "node22" });
    const result = spawnSync(process.execPath, [outfile], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${name} failed (${result.status ?? result.signal}).`);
  }
} finally {
  await rm(output, { recursive: true, force: true });
}

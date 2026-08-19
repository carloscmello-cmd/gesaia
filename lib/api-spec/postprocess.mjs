/**
 * Postprocess Orval v8 generated Zod output to be compatible with Zod v3.
 *
 * Orval v8 targets Zod v4 APIs; we are on Zod v3.
 * Replacements:
 *   zod.looseObject({...}) → zod.record(zod.string(), zod.unknown())
 *   zod.int()              → zod.number().int()
 *   zod.email()            → zod.string().email()
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { join, resolve } from "path";

const packageDir = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = process.env.ORVAL_OUTPUT_ROOT
  ? resolve(process.env.ORVAL_OUTPUT_ROOT)
  : resolve(packageDir, "../..");
const generatedDir = join(workspaceRoot, "lib/api-zod/src/generated");

function getAllTs(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...getAllTs(full));
    } else if (entry.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

let totalFixed = 0;

for (const file of getAllTs(generatedDir)) {
  let src = readFileSync(file, "utf8");
  const before = src;

  // Replace looseObject({...}) — always empty in our spec (bare type:object)
  // Handles multiline: zod.looseObject({\n\n})
  src = src.replace(/zod\.looseObject\(\{[\s\S]*?\}\)/g, "zod.record(zod.string(), zod.unknown())");

  // Replace zod.int() with zod.number().int()
  src = src.replace(/zod\.int\(\)/g, "zod.number().int()");

  // Replace zod.email() with the Zod v3-compatible string schema
  src = src.replace(/zod\.email\(\)/g, "zod.string().email()");

  if (src !== before) {
    writeFileSync(file, src, "utf8");
    const count =
      (before.match(/zod\.looseObject/g) || []).length +
      (before.match(/zod\.int\(\)/g) || []).length +
      (before.match(/zod\.email\(\)/g) || []).length;
    console.log(`Fixed ${count} occurrence(s) in ${file}`);
    totalFixed += count;
  }
}

console.log(`\nPostprocess complete. Total replacements: ${totalFixed}`);

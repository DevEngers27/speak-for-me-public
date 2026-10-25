#!/usr/bin/env node
// Regenerates templates/ci.yml from DEFAULT_CI_OPTIONS.
// Usage: render-cli.ts [outFile]   (prints to stdout when outFile is "-")
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCiWorkflow } from "./workflow.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.join(here, "../../templates/ci.yml");
const yaml = renderCiWorkflow();
if (out === "-") process.stdout.write(yaml);
else {
  writeFileSync(out, yaml);
  console.log(`Wrote ${out}`);
}

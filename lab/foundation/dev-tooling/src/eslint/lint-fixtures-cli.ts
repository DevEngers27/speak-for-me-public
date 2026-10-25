#!/usr/bin/env node
// Lints a fixture project with the boundary config and checks every
// must-fail / must-pass expectation. Usage: lint-fixtures-cli.ts [projectDir]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatFixtureResults, lintFixtureProject } from "./fixtures.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(process.argv[2] ?? path.join(here, "../../fixtures/project"));
const results = await lintFixtureProject({ projectDir });
console.log(formatFixtureResults(results));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;

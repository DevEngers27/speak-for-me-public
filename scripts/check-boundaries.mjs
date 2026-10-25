import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
// W2-4: real lifecycle modules are now covered by tsconfig, not default-project fixtures.
import { findLayerImportViolations } from './lib/layer-imports.mjs';

// Virtual fixtures use real layer paths without polluting lint or TypeScript inputs.
const fixtures = [
  ...['convex/violation.ts', 'core/engine/violation.ts', 'core/scenarios/scope-change/allowed.ts']
    .flatMap(file => ['export const load = () => import("./dependency");', 'export const load = (name: string) => import(name);']
      .map(code => [file, code, 'isolate/static-imports'])),
  ['core/scenarios/scope-change/allowed.ts', 'import { cents } from "../../engine/money";', 'no-restricted-syntax'],
  ...[
    'import { vi } from "vitest";',
    'import type { TestConvex } from "convex-test";',
    'import "@edge-runtime/vm";',
    'export * from "vitest";',
    'const test = require("convex-test");',
    'export async function load() { return await import("vitest"); }',
    'export type Tester = import("convex-test").TestConvex<never>;',
  ].map(code => ['convex/violation.ts', code, 'test-deps/imports']),
  ['convex/violation.ts', 'import Anthropic from "@anthropic-ai/sdk";', 'gateway/sdk-location'],
  ['convex/violation.ts', 'export * from "@anthropic-ai/sdk";', 'gateway/sdk-location'],
  ['convex/violation.ts', 'const sdk = require("@anthropic-ai/sdk");', 'gateway/sdk-location'],
  ['convex/model/views/x.ts', 'import { opsLog as log } from "../../lib/opsLog.js";', 'no-restricted-imports'],
  ['core/engine/violation.ts', 'import { v } from "convex/values";', 'no-restricted-imports'],
  ['convex/model/views/x.ts', 'import * as log from "../../lib/opsLog.js"; export { log };', 'foundation/public-ops-log'],
  ['convex/model/views/x.ts', 'export { opsLog as x } from "../../lib/opsLog.js";', 'foundation/public-ops-log'],
  ['convex/model/views/x.ts', 'export * from "../../lib/opsLog.js";', 'foundation/public-ops-log'],
  ['convex/rooms.ts', 'import { opsLog } from "./lib/opsLog.js"; const x = memberMutation({}); export { x };', 'foundation/public-ops-log'],
  ['convex/rooms.ts', 'import * as log from "./lib/opsLog.js"; const x = memberMutation({}); export { x, log };', 'foundation/public-ops-log'],
  ['convex/rooms.ts', 'export { opsLog as x } from "./lib/opsLog.js"; export const y = memberMutation({});', 'foundation/public-ops-log'],
  ['convex/rooms.ts', 'import { memberMutation as make } from "./lib/functions.js"; import { opsLog } from "./lib/opsLog.js"; const x = make({}); export { x };', 'foundation/public-ops-log'],
  ['convex/rooms.ts', 'console.log("secret");', 'no-console'],
  ['convex/model/views/x.ts', 'import { opsLog } from "../../lib/opsLog";', 'no-restricted-imports'],
  ['convex/rooms.ts', 'import { opsLog } from "./lib/opsLog"; export const x = memberMutation({});', 'foundation/public-ops-log'],
  ['convex/x.ts', 'Promise.resolve(1);', '@typescript-eslint/no-floating-promises'],
  ['core/engine/x.ts', 'export function check(x: "a" | "b") {switch(x) {case "a": return 1;}}', '@typescript-eslint/switch-exhaustiveness-check'],
  ['convex/violation.ts', 'import { cents } from "../../core/engine/money";', 'no-restricted-syntax'],
  ['convex/violation.ts', 'import { query } from "./_generated/server";', 'no-restricted-imports'],
  ['core/engine/violation.ts', 'import "convex/server";', 'no-restricted-imports'],
  ['core/engine/violation.ts', 'import "react";', 'no-restricted-imports'],
  ['src/violation.ts', 'import "@convex/engine/auth";', 'no-restricted-imports'],
  ['src/violation.ts', 'import "../../convex/_generated/api";', 'no-restricted-imports'],
  ['convex/violation.ts', 'import "@/lib/config";', 'no-restricted-imports'],
  ...['Date.now()', 'new Date()', 'Intl.DateTimeFormat()', 'Math.random()', 'fetch("/")', 'globalThis.Date.now()'].map(code => ['core/engine/violation.ts', `${code};`, code.startsWith('Math') || code.startsWith('globalThis') ? 'no-restricted-properties' : 'no-restricted-globals']),
  ['core/engine/violation.ts', 'import "zod";', 'no-restricted-imports'],
];
const eslint = new ESLint({overrideConfig: [{
  files: ['core/**/*.ts', 'convex/**/*.ts'],
  languageOptions: {parserOptions: {projectService: {
    allowDefaultProject: ['core/engine/violation.ts', 'convex/violation.ts', 'convex/allowed.ts', 'core/scenarios/scope-change/allowed.ts', 'convex/model/views/x.ts', 'convex/x.ts', 'core/engine/x.ts', 'convex/lib/opsLog.fixture.ts'].filter(file => !existsSync(file)),
    maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 12,
  }}},
}]});
for (const [filePath, code, rule] of fixtures) {
  const [result] = await eslint.lintText(code, { filePath });
  const errors = result.messages.filter(message => message.ruleId === rule && message.severity === 2);
  assert.ok(errors.length, `${filePath}: expected ${rule} for ${code}`);
  console.log(`REJECTED ${filePath}: ${code} (${rule})`);
}
for (const filePath of ['src/allowed.ts', 'convex/allowed.ts', 'core/scenarios/scope-change/allowed.ts']) {
  const code = filePath.startsWith('src/') ? 'import "@convex/_generated/api"; import type { DataModel } from "@convex/_generated/dataModel"; export type Model = DataModel;' : 'import "@core/engine";';
  const [result] = await eslint.lintText(code, { filePath });
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
}
for (const [filePath, code] of [
  ['convex/model/agents/modelGateway.ts', 'import "@anthropic-ai/sdk";'],
  ['convex/lib/opsLog.fixture.ts', 'console.log("fixture");'],
  ['convex/lib/opsLog.ts', 'console.log("allowed logger");'],
  ['convex/model/views/x.ts', 'import { publicOpsLog } from "../../lib/opsLog"; export { publicOpsLog };'],
  ['convex/model/views/x.ts', 'export { publicOpsLog as x } from "../../lib/opsLog.js";'],
  ['convex/rooms.ts', 'import { publicOpsLog } from "./lib/opsLog.js"; const x = memberMutation({}); export { x, publicOpsLog };'],
  ['convex/x.ts', 'export async function check() { await Promise.resolve(1); }'],
  ['core/engine/x.ts', 'export function check(x: "a" | "b") {switch(x) {case "a": return 1; case "b": return 2;}}'],
]) {
  const [result] = await eslint.lintText(code, {filePath});
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
}
console.log(`${fixtures.length} deliberate violations rejected; allowed imports passed.`);

const virtual = [
  ['core/engine/probe.ts', 'import { read } from "../../shared/util";', 'unclassified'],
  ['core/engine/probe.ts', 'import fs from "fs";', 'builtin'],
  ['core/engine/probe.ts', 'import { readFileSync } from "node:fs";', 'builtin'],
  ['core/scenarios/scope-change/probe.ts', 'import path from "path";', 'builtin'],
];
for (const [filePath, code, kind] of virtual) {
  const violations = findLayerImportViolations(filePath, code);
  assert.ok(violations.some(violation => violation.kind === kind), `${filePath} should reject ${code}`);
}
assert.deepEqual(findLayerImportViolations('core/engine/ok.ts', 'import { sibling } from "./sibling";'), []);

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === '_generated' || entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
}
const sources = [];
for (const root of ['core', 'convex', 'src']) walk(root, sources);
const repoViolations = [];
for (const filePath of sources) {
  repoViolations.push(...findLayerImportViolations(filePath, readFileSync(filePath, 'utf8')));
}
assert.deepEqual(repoViolations, [], JSON.stringify(repoViolations, null, 2));
console.log(`Layer import scan passed for ${sources.length} files (${virtual.length} extra fixtures).`);

// --- W2-6 BEGIN ---
const w26SrcViolations = [
  ['src/violation.ts', 'import { checkProposal } from "@core/engine";', 'no-restricted-imports'],
  ['src/violation.ts', 'import { checkProposal } from "@core/engine/rules";', 'no-restricted-imports'],
  ['src/violation.ts', 'import { scopeChangeScenario } from "@core/scenarios/scope-change";', 'no-restricted-imports'],
  ['src/violation.ts', 'import { checkProposal } from "../core/engine";', 'no-restricted-imports'],
];
for (const [filePath, code, rule] of w26SrcViolations) {
  const [result] = await eslint.lintText(code, { filePath });
  const errors = result.messages.filter(message => message.ruleId === rule && message.severity === 2);
  assert.ok(errors.length, `${filePath}: expected ${rule} for ${code}`);
  console.log(`REJECTED ${filePath}: ${code} (${rule})`);
}
{
  const [result] = await eslint.lintText(
    'import { APP_NAME, formatCents } from "@core/engine/ui"; export { APP_NAME, formatCents };',
    { filePath: 'src/allowed.ts' },
  );
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
}
// --- W2-6 END ---

// W2-1: L5/L8/L9 counterexamples, independent of other lanes' fixtures.
for (const [filePath, code, rule] of [
  ['convex/violation.ts', 'import { httpAction } from "./_generated/server";', 'w21/platform'],
  ['convex/violation.ts', 'export async function write(ctx) { await ctx.db.patch("id", {}); }', 'w21/platform'],
  ['convex/violation.ts', 'export async function write(db) { await db.patch("id", {}); }', 'w21/platform'],
  ['convex/violation.ts', 'export const now = Date.now();', 'w21/platform'],
  ['convex/model/views/x.ts', 'export const view = doc => ({...doc});', 'w21/platform'],
]) {
  const [result] = await eslint.lintText(code, {filePath});
  assert.ok(result.messages.some(message => message.ruleId === rule && message.severity === 2), `W2-1 failed to reject ${code}`);
}
console.log('W2-1: L5/L8/L9 counterexamples rejected.');
// End W2-1.

// W2-3: enforce immutable constraint sources and the bump call graph.
const { findConstraintWriteViolations } = await import('./lib/constraint-writes.mjs');
const constraintViolations = sources.flatMap(filePath => findConstraintWriteViolations(filePath, readFileSync(filePath, 'utf8')));
assert.deepEqual(constraintViolations, [], JSON.stringify(constraintViolations, null, 2));
for (const code of [
  'ctx.db.patch(roomId, { constraintsVersion: 2 });',
  'ctx.tx.patch("rooms", roomId, { constraintsVersion });',
  'ctx.db.patch(briefId, { hardFields: secret });',
  'async function unsafe() { await bump(tx, args); }',
]) assert.ok(findConstraintWriteViolations('convex/model/probe.ts', code).length, code);
console.log(`W2-3 constraint write scan passed (${sources.length} files; 4 mutation fixtures rejected).`);
// End W2-3.

// W2-10: runtime bindings must not lead eager registration back to itself.
const { checkPluginClosure, reportPluginClosure } = await import('./check-plugin-closure.mjs');
reportPluginClosure();
for (const target of ['././index.js', '././plugin.js']) {
  const member = path.resolve('core/scenarios/scope-change/catalog.ts');
  const code = readFileSync(member, 'utf8') + `\nimport { scopeChangePlugin as closureProbe } from '${target}';\nexport const closureCounterexample = closureProbe;\n`;
  assert.throws(() => checkPluginClosure(new Map([[member, code]])), /Forbidden runtime closure edge/);
}
console.log('Plugin closure counterexamples rejected: member -> scenario barrel; member -> plugin.ts.');

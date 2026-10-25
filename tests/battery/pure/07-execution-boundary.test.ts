import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it as vitestIt } from "vitest";

const runtimeAllowed = new Set(['next', 'react', 'react-dom', 'convex', '@clerk/nextjs', '@clerk/react', '@anthropic-ai/sdk', 'zod', 'server-only']);
const allowed = (deps: Record<string, string>) => Object.keys(deps).every(name => runtimeAllowed.has(name));
const devAllowed = new Set(['@clerk/testing', '@edge-runtime/vm', '@playwright/test', '@types/node', '@types/react', '@types/react-dom', 'convex-test', 'eslint', 'eslint-config-next', 'typescript', 'vite', 'vitest', '@testing-library/dom', '@testing-library/react', 'jsdom', 'eslint-plugin-boundaries', 'eslint-import-resolver-typescript', '@typescript-eslint/parser', 'tsx']);
const allowedDev = (deps: Record<string, string>) => Object.keys(deps).every(name => devAllowed.has(name));
const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {dependencies: Record<string, string>; devDependencies: Record<string, string>};
const boundaryOutput = execFileSync(process.execPath, ['scripts/check-boundaries.mjs'], {encoding: 'utf8'});


// W2-2 / W2-1: union of production assertions; registry titles retained.
const implemented: Record<string, () => void | Promise<void>> = {
  'INV-60': () => {
    const source = readFileSync('convex/model/executions.ts','utf8');
    expect(source).not.toMatch(/\bfetch\s*\(|\.runAfter\s*\(|\.runAction\s*\(|\.scheduler\b/);
    const inserted = [...source.matchAll(/\.insert\(['"]([^'"]+)['"]/g)].map(match=>match[1]);
    expect(inserted).toEqual(['executions','changeOrders','tasks']);
    expect(source).toContain("appendLedgerEntry(tx.roomTx,");
    expect(source).toContain("kind: 'commit'");
    const ledgerSource = readFileSync('convex/model/ledger.ts','utf8');
    expect([...ledgerSource.matchAll(/\.insert\(['"]([^'"]+)['"]/g)].map(match => match[1])).toEqual(['ledgerEntries']);
    expect(source).not.toMatch(/ctx\.db\.(?:insert|patch|replace|delete)\s*\(/);
    expect(readFileSync('convex/schema.ts','utf8')).not.toMatch(/outbox\s*:\s*defineTable/);
  },
  'CE-148': () => {
    const source = readFileSync('convex/model/executions.ts','utf8');
    expect(source).not.toMatch(/["']use node["']|\.runAfter\s*\(|from\s+["'][^"']*(?:actions|agents)[^"']*["']/);
    const forbidden = (code:string) => /["']use node["']|\.runAfter\s*\(|from\s+["'][^"']*(?:actions|agents)[^"']*["']/.test(code);
    expect(forbidden(source+"\nctx.scheduler.runAfter(0, action, {});")).toBe(true);
    expect(forbidden(source+"\nimport run from './agents';")).toBe(true);
  },
  'CE-151': async () => {
    const sources = import.meta.glob(['../../../convex/*.ts', '!../../../convex/*.test.ts', '!../../../convex/auth.config.ts', '!../../../convex/schema.ts']);
    const actions: string[] = [];
    for (const [file, load] of Object.entries(sources)) {
      const exports = await load() as Record<string, {isAction?:boolean;isPublic?:boolean}>;
      for (const [name, entry] of Object.entries(exports)) if (entry?.isAction && entry.isPublic) actions.push(`${file.split('/').pop()!.replace('.ts','')}.${name}`);
    }
    expect(actions).toEqual(['invites.createLink']);
  },
};
const it = new Proxy(vitestIt, { get(target,key) {
  if (key === 'todo') return (title: string) => { const body = implemented[title.split(' ')[0]!]; if(body) vitestIt(title,body); else vitestIt.todo(title); };
  return Reflect.get(target,key);
} });
// End W2-2 / W2-1.

describe("P · 07-execution-boundary", () => {
  it("INV-59 代码库对外部 ERP / 支付 / 签署 / 邮件 SDK 零依赖：`package.json` 直接依赖 ⊆ 白名单（next、react、convex、@clerk/*、@anthropic-ai/sdk、zod 与 D20 列出的开发依赖）；`core/engine` 禁 `Date` / `Intl` / `Math.random` / `fetch` / `convex/*` / `zod`（ESLint 纯度规则）；`convex/executions*.ts` 与 `approvals.ts` 不 import 任何 action、HTTP 客户端或 `\"use node\"` 模块", () => { expect(allowed(manifest.dependencies)).toBe(true); expect(allowedDev(manifest.devDependencies)).toBe(true); expect(boundaryOutput).toContain('deliberate violations rejected'); });
  it.todo("INV-60 执行只写内部表：`executions`、`ledgerEntries`、`changeOrders`、`tasks`、`events` 与 `proposals` / `runs` / `rooms` 的状态字段；执行路径上没有 action、没有 `fetch`、没有 `runAfter`；代码库唯一公开 action 是邀请 token 生成（`invites.createLink`，只做随机数与哈希，经 internal `invites.authorizeLink` / `invites.insertLink` 写入；`invites.create` 是邮箱定向的 memberMutation）；v1 无 outbox 表、无 CSV 导出");
  it("CE-147 变异：`package.json` 加入 `stripe` / `@sap/*` / `docusign-*` / `nodemailer`", () => { for (const name of ['stripe', '@sap/client', 'docusign-esign', 'nodemailer']) { expect(allowed({...manifest.dependencies, [name]: '1.0.0'})).toBe(false); expect(allowedDev({...manifest.devDependencies, [name]: '1.0.0'})).toBe(false); } });
  it.todo("CE-148 变异：`convex/executions.ts` import `\"use node\"` 模块或 action；`executeIfComplete` 内 `runAfter`");
  it("CE-149 变异：`core/engine` 内出现 `Date.now()` / `fetch` / `import { v } from 'convex/values'`", () => { const output = boundaryOutput; for (const code of ['Date.now()', 'fetch', 'convex/values']) expect(output).toContain(code); });
  it.todo("CE-151 枚举 `convex/` 的公开 action");
});

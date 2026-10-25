// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import ts from 'typescript';

// Use the same esbuild installation as the Convex CLI.
const require = createRequire(import.meta.url);
const convexRequire = createRequire(require.resolve('convex/package.json'));
const { build } = convexRequire('esbuild') as {
  build(options: Record<string, unknown>): Promise<{ metafile?: { inputs: Record<string, unknown> } }>;
};
// supported:false alone can lower import() into a require shim; explicitly reject
// it before bundling so successful Node loading cannot hide isolate incompatibility.
const runtimeImportGuard = {
  name: 'convex-static-imports',
  setup(builder: { onLoad(filter: { filter: RegExp }, load: (args: { path: string }) => Promise<undefined>): void }) {
    builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, async ({ path: file }) => {
      if (file.includes('node_modules')) return;
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          throw new Error(`Convex runtime forbids dynamic import(): ${file}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    });
  },
};
const runtimeBuild = (options: Record<string, unknown>) => build({
  ...options, supported: { 'dynamic-import': false }, plugins: [runtimeImportGuard],
});
const run = promisify(execFile);
async function entries(directory: string): Promise<string[]> {
  const found = await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '_generated' ? [] : entries(name);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [name] : [];
  }));
  return found.flat().sort();
}

test('every Convex entry bundles and loads in a fresh Node process', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'convex-module-load-'));
  try {
    const modules = await entries('convex');
    expect(modules.length).toBeGreaterThan(0);
    // Bundle entries together per runtime, as Convex does. Independent
    // bundles alone miss the initialization order introduced by shared chunks.
    // Normal esbuild resolution uses the checked-in _generated/*.js facades.
    for (const platform of ['browser', 'node']) {
      const entryPoints = [];
      for (const entry of modules) {
        const source = ts.createSourceFile(entry, await readFile(entry, 'utf8'), ts.ScriptTarget.Latest);
        const node = source.statements.some(statement => ts.isExpressionStatement(statement)
          && ts.isStringLiteral(statement.expression) && statement.expression.text === 'use node');
        if (node === (platform === 'node')) entryPoints.push(entry);
      }
      if (!entryPoints.length) continue;
      await runtimeBuild({
        entryPoints,
        outdir: directory,
        outbase: '.',
        outExtension: { '.js': '.mjs' },
        bundle: true,
        platform,
        format: 'esm',
        target: 'esnext',
        splitting: true,
        conditions: ['convex', 'module'],
        keepNames: true,
        minifySyntax: true,
        minifyIdentifiers: true,
      });
    }
    const results = await Promise.allSettled(modules.map(async (entry) => {
      const outfile = path.join(directory, entry.replace(/\.ts$/, '.mjs'));
      try {
        const { stderr } = await run(process.execPath, [outfile], {
          timeout: 15_000,
          // auth.config.ts requires an issuer, but module loading needs no credentials.
          env: { ...process.env, CLERK_JWT_ISSUER_DOMAIN: 'https://module-load.example.test' },
        });
        expect(stderr, entry).not.toContain('Missing plugin member');
      } catch (error) {
        throw new Error(`Module load failed: ${entry}`, { cause: error });
      }
    }));
    const failures = results.filter((result) => result.status === 'rejected');
    expect(failures).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test('module-load canary rejects a dynamic import before esbuild can lower it', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'convex-dynamic-import-'));
  try {
    const entry = path.join(directory, 'entry.ts');
    await writeFile(entry, 'export const load = () => import("./target.ts");');
    await writeFile(path.join(directory, 'target.ts'), 'export const value = 1;');
    await expect(runtimeBuild({ entryPoints: [entry], bundle: true, write: false,
      platform: 'browser', format: 'esm', logLevel: 'silent' }))
      .rejects.toThrow('Convex runtime forbids dynamic import()');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// Like check-plugin-closure: inspect the emitted runtime closure, not type-only
// references. These modules must never return to the orchestration facades.
test('constraint and clock ports have no runtime edge back to lifecycle facades', async () => {
  const result = await runtimeBuild({
    entryPoints: ['convex/model/constraints/protocol.ts', 'convex/model/constraints/adapter.ts',
      'convex/model/constraints/readiness.ts', 'convex/model/clockDate.ts'],
    bundle: true, write: false, outdir: '/tmp/lifecycle-closure',
    platform: 'browser', format: 'esm', metafile: true,
  });
  const closure = Object.keys(result.metafile!.inputs);
  for (const facade of ['runs.ts', 'constraints.ts', 'clock.ts']) {
    expect(closure, `Runtime dependency returns to ${facade}`).not.toContain(`convex/model/${facade}`);
  }
});

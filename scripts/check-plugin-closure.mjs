import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const entry = path.join(root, 'core/scenarios/scope-change/plugin.ts');
const forbidden = new Set([
  entry,
  path.join(root, 'core/scenarios/scope-change/index.ts'),
  path.join(root, 'core/engine/index.ts'),
].map(file => realpathSync(file)));

// Resolve runtime bindings through transparent re-export barrels. Type-only and
// unused imports are erased first, exactly as they are for the deployed bundle.
// The entry is not part of its own dependency closure unless an edge returns to it.
export function checkPluginClosure(overrides = new Map()) {
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  host.readFile = file => overrides.get(path.resolve(file)) ?? read(file);
  const program = ts.createProgram([entry], options, host);
  const checker = program.getTypeChecker();
  const closure = new Set();
  const visited = new Set();
  function resolve(specifier, file) {
    const resolved = ts.resolveModuleName(specifier, file, options, host).resolvedModule;
    assert.ok(resolved, `Unresolved runtime import ${specifier} in ${file}`);
    return realpathSync(resolved.resolvedFileName);
  }
  function edge(file, from) {
    file = realpathSync(file);
    assert.ok(!forbidden.has(file), `Forbidden runtime closure edge: ${path.relative(root, from)} -> ${path.relative(root, file)}`);
    closure.add(file);
    visit(file);
  }
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = program.getSourceFile(file);
    assert.ok(source, `Missing graph source: ${file}`);
    const emitted = ts.transpileModule(host.readFile(file), { compilerOptions: options }).outputText;
    const runtime = ts.createSourceFile(file, emitted, ts.ScriptTarget.ESNext, true);
    function dynamicEdges(node) {
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        assert.ok(node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]),
          `Nonliteral runtime import in ${file}`);
        edge(resolve(node.arguments[0].text, file), file);
      }
      ts.forEachChild(node, dynamicEdges);
    }
    dynamicEdges(runtime);
    for (const statement of runtime.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier) continue;
      const target = resolve(statement.moduleSpecifier.text, file);
      // Scenario barrels and registration modules are never transparent here:
      // even an otherwise unused value import can change eager initialization.
      if (forbidden.has(target) && target !== path.join(root, 'core/engine/index.ts')) edge(target, file);
      const bindings = ts.isImportDeclaration(statement)
        ? statement.importClause?.namedBindings
        : statement.exportClause;
      if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
        for (const binding of bindings.elements) {
          const originalBinding = source.statements
            .filter(node => node.kind === statement.kind && node.moduleSpecifier?.text === statement.moduleSpecifier.text)
            .flatMap(node => (ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause)?.elements ?? [])
            .find(item => item.name.text === binding.name.text);
          let symbol = originalBinding && checker.getSymbolAtLocation(originalBinding.name);
          if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
          const declarations = symbol?.declarations ?? [];
          assert.ok(declarations.length, `Unresolved runtime binding ${binding.name.text} in ${file}`);
          for (const declaration of declarations) edge(declaration.getSourceFile().fileName, file);
        }
      } else {
        edge(target, file);
      }
    }
  }
  visit(entry);
  return [...closure].map(file => path.relative(root, file)).sort();
}

export function reportPluginClosure() {
  const closure = checkPluginClosure();
  const message = `Plugin runtime closure passed: ${closure.length} resolved dependency modules; plugin.ts, scenario index.ts, engine index.ts absent.`;
  console.log(message);
  return message;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) reportPluginClosure();

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const canonical = 'convex/model/agents/modelGateway.ts';

/** Trace imported bindings and local aliases, including namespace and star exports. */
function seamExports(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const aliases = new Set(['callModel']);
  const namespaces = new Set<string>();
  const declarations: ts.VariableDeclaration[] = [];
  const gatewayModule = (node: ts.Expression | undefined) =>
    node &&
    ts.isStringLiteral(node) &&
    /(?:^|\/)modelGateway(?:\.[cm]?[jt]s)?$/.test(node.text);
  function isAlias(node: ts.Expression): boolean {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return isAlias(node.expression);
    return ts.isIdentifier(node)
      ? aliases.has(node.text)
      : ts.isPropertyAccessExpression(node)
        ? ts.isIdentifier(node.expression) &&
          namespaces.has(node.expression.text) &&
          node.name.text === 'callModel'
        : ts.isElementAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          namespaces.has(node.expression.text) &&
          !!node.argumentExpression &&
          ts.isStringLiteral(node.argumentExpression) &&
          node.argumentExpression.text === 'callModel';
  }
  function collect(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      gatewayModule(node.moduleSpecifier) &&
      !node.importClause?.isTypeOnly
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const binding of bindings.elements) {
          if (
            !binding.isTypeOnly &&
            (binding.propertyName ?? binding.name).text === 'callModel'
          )
            aliases.add(binding.name.text);
        }
    }
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, collect);
  }
  collect(source);
  let previousSize: number;
  do {
    previousSize = aliases.size;
    for (const declaration of declarations) {
      if (!declaration.initializer) continue;
      if (ts.isIdentifier(declaration.name) && isAlias(declaration.initializer))
        aliases.add(declaration.name.text);
      if (
        ts.isObjectBindingPattern(declaration.name) &&
        ts.isIdentifier(declaration.initializer) &&
        namespaces.has(declaration.initializer.text)
      ) {
        for (const binding of declaration.name.elements)
          if (
            ts.isIdentifier(binding.name) &&
            (binding.propertyName?.getText(source) ?? binding.name.text) ===
              'callModel'
          )
            aliases.add(binding.name.text);
      }
    }
  } while (aliases.size !== previousSize);
  const violations: string[] = [];
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const exportsSeam =
        !node.exportClause || ts.isNamespaceExport(node.exportClause)
          ? gatewayModule(node.moduleSpecifier)
          : node.exportClause.elements.some(
              (binding) =>
                !binding.isTypeOnly &&
                (binding.name.text === 'callModel' ||
                  (binding.propertyName ?? binding.name).text === 'callModel' ||
                  (!node.moduleSpecifier &&
                    aliases.has((binding.propertyName ?? binding.name).text))),
            );
      if (exportsSeam) violations.push(node.getText(source));
    }
    if (ts.isExportAssignment(node) && isAlias(node.expression))
      violations.push(node.getText(source));
    const exported =
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'callModel' &&
      file !== canonical
    )
      violations.push(node.getText(source));
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          aliases.has(declaration.name.text),
      )
    )
      violations.push(node.getText(source));
  }
  return violations;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(file)
      : /\.[cm]?[jt]sx?$/.test(file)
        ? [file]
        : [];
  });
}

it('D21 callModel is exported only from convex/model/agents', () => {
  expect(existsSync('convex/lib/modelGateway.ts')).toBe(false);
  expect(existsSync('convex/agents/modelGateway.ts')).toBe(false);
  const source = readFileSync(canonical, 'utf8');
  expect(source).toContain('export async function callModel');
  expect(source).not.toMatch(
    /export (?:const|(?:async )?function) (?:callStructured|callNegotiationModel)/,
  );
  for (const file of [...sourceFiles('convex'), ...sourceFiles('src')])
    expect(seamExports(file, readFileSync(file, 'utf8')), file).toEqual([]);
  // Counterexamples ensure the scan catches re-exports and renamed/chained bindings.
  for (const text of [
    'export {callModel as other} from "./modelGateway";',
    'export * from "./modelGateway";',
    'export * as gateway from "./modelGateway";',
    'import {callModel as invoke} from "./modelGateway"; const alias = invoke; export {alias};',
    'import * as gateway from "./modelGateway"; export const alias = gateway.callModel;',
    'import * as gateway from "./modelGateway"; const {callModel: invoke} = gateway; export default invoke;',
    'export async function callModel() {}',
  ])
    expect(seamExports('convex/seam.ts', text), text).not.toEqual([]);
});

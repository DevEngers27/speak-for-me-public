/** W2-3 / CC-17: source immutability and the single bump call graph.
 * The sole version patch is inside bump, through the landed RoomTx facade.
 */
import ts from 'typescript';

// W2-12: date advancement is composed in both clock and runs via callbacks;
// the sole version writer moved into constraints/protocol.ts.
// runs.ts retains its public lifecycle API, delegating to the sole bump implementation.
const CALLERS=new Map([['convex/model/runs.ts',new Set(['bump','openIfReady','withConstraintChange','rollLocalDateTx'])],['convex/model/constraints.ts',new Set(['withConstraintChange','openIfReady'])],['convex/model/clock.ts',new Set(['rollLocalDateTx'])]]);
function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression)) return node.expression.text;
  return undefined;
}
function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isFunctionLike(current)) continue;
    if (current.name) return propertyName(current.name);
    if (ts.isVariableDeclaration(current.parent) || ts.isPropertyAssignment(current.parent)) return propertyName(current.parent.name);
  }
  return undefined;
}
function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression;
  return node;
}
function member(node) {
  if (ts.isPropertyAccessExpression(node)) return { receiver: node.expression, name: node.name.text };
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) return { receiver: node.expression, name: node.argumentExpression.text };
  return undefined;
}

/** @returns {{file: string, line: number, kind: string, field?: string, caller?: string}[]} */
export function findConstraintWriteViolations(filePath, source) {
  const file = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (/\.(?:test|fixture)\.[cm]?[jt]sx?$/.test(file) || file.includes('/_generated/')) return [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bumpNames = new Set(['bump']);
  for (const statement of ast.statements) if (ts.isImportDeclaration(statement)) {
    for (const element of statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) ? statement.importClause.namedBindings.elements : []) {
      if ((element.propertyName ?? element.name).text === 'bump') bumpNames.add(element.name.text);
    }
  }
  const violations = [];
  const report = (node, details) => violations.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, ...details });
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const access = member(callee);
      const caller = enclosingFunction(node);
      if ((ts.isIdentifier(callee) && bumpNames.has(callee.text)) || access?.name === 'bump') {
        if (!CALLERS.get(file)?.has(caller)) report(node, { kind: 'unauthorized-bump', caller });
      }
      if (access?.name === 'patch') {
        const receiver = unwrap(access.receiver);
        const receiverName = ts.isIdentifier(receiver) ? receiver.text : member(receiver)?.name;
        if (receiverName === 'db' || receiverName === 'tx') {
          const patch = unwrap(node.arguments.at(-1));
          if (patch && ts.isObjectLiteralExpression(patch)) for (const property of patch.properties) {
            const field = property.name && propertyName(property.name);
            if (field !== 'constraintsVersion' && field !== 'hardFields') continue;
            const adapter=field==='constraintsVersion'&&file==='convex/model/constraints/protocol.ts'&&caller==='bump';
            if (!adapter) report(node, { kind: 'immutable-constraint-write', field, caller });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return violations;
}

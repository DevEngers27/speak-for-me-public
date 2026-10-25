import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ACTION_MATRIX } from '../convex-helpers/actionMatrix';

function files(dir:string):string[] { return readdirSync(dir,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? files(path.join(dir,entry.name)) : [path.join(dir,entry.name)]); }
const production = () => files('convex').filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts') && !path.basename(file).includes('.',path.basename(file).indexOf('.')+1) && !file.includes(`${path.sep}test${path.sep}`) && !file.includes(`${path.sep}_generated${path.sep}`));
function parse(file:string) { return ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true); }
function walk(node:ts.Node, visit:(node:ts.Node)=>void) { visit(node); node.forEachChild(child => walk(child,visit)); }
function rootCallee(expression:ts.Expression):string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isCallExpression(expression)) return rootCallee(expression.expression);
  return null;
}

describe('W2-2 execution boundary structure', () => {
  it('API-6 E12 executeIfComplete has exactly one production caller, approvals.record', () => {
    const callers:string[] = [];
    for (const file of production()) walk(parse(file),node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'executeIfComplete') callers.push(file.replaceAll(path.sep,'/'));
    });
    expect(callers).toEqual(['convex/approvals.ts']);
  });
  it('API-6 E12 execution module imports no constraints, actions, scheduler or fetch', () => {
    const forbidden:string[] = [];
    walk(parse('convex/model/executions.ts'),node => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /constraints|actions?|scheduler|fetch/i.test(node.moduleSpecifier.text)) forbidden.push('import');
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['fetch','runAfter','runAt','runAction'].includes(node.expression.text)) forbidden.push(node.expression.text);
      if (ts.isPropertyAccessExpression(node) && ['scheduler','runAfter','runAt','runAction','fetch'].includes(node.name.text)) forbidden.push(node.name.text);
    });
    expect(forbidden).toEqual([]);
  });
  it('TC-AUTH-07 ACTION_MATRIX exactly inventories every registered public UDF in this tree', () => {
    const registered:string[] = [];
    for (const file of production()) {
      if (file.startsWith('convex/model/')) continue;
      walk(parse(file),node => {
        if (!ts.isVariableStatement(node) || !node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) return;
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
          const builder = rootCallee(declaration.initializer.expression);
          if (!builder || !['query','mutation','action','anonQuery','memberQuery','memberMutation','userQuery','userMutation','userAction'].includes(builder)) continue;
          registered.push(`${file.replace(/^convex\//,'').replace(/\.ts$/,'')}:${declaration.name.text}`);
        }
      });
    }
    expect(registered.sort()).toEqual(ACTION_MATRIX.map(row => row.name.replace(/\.([^.]+)$/, ':$1')).sort());
  });
});

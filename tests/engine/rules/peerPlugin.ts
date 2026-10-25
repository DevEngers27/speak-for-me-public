import ts from 'typescript';

/** Derive the required member list directly from the merged contract type. */
export function requiredMembers(source: string) {
  const file = ts.createSourceFile('plugin.ts', source, ts.ScriptTarget.Latest, true);
  const contract = file.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'ScenarioPlugin');
  if (!contract || !ts.isInterfaceDeclaration(contract)) throw new Error('Missing ScenarioPlugin interface');
  return contract.members.filter(member => !('questionToken' in member && member.questionToken)).map(member => member.name!.getText(file));
}

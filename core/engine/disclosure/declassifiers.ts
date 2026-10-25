/** §7.8.6: extract only role-projected, normalized boundary values, never raw private records. */
type Boundary = Readonly<Record<string, unknown>>;
function values(source: unknown, parts: readonly string[]): unknown {
  if (!parts.length) return source;
  if (Array.isArray(source)) return source.map(row => values(row, parts));
  if (source === null || typeof source !== 'object') return undefined;
  return values((source as Boundary)[parts[0]!], parts.slice(1));
}
function declaration(paths: readonly string[]) {
  return Object.freeze({ paths, extract: (boundary: Boundary) => paths.map(path => values(boundary, path.split('.'))) });
}
export const DECLASSIFIED = ['DX-1', 'DX-2', 'DX-3', 'DX-4', 'DX-5', 'DX-6', 'DX-7', 'DX-8', 'DX-9', 'DX-10', 'DX-11', 'DX-12', 'DX-13'] as const;
export const DECLASSIFIERS = Object.freeze({
  'DX-1': declaration(['view.proposal.fit', 'context.feedback.outcome']),
  'DX-2': declaration(['view.run.status']),
  'DX-3': declaration(['view.request.kind', 'view.request.toRole']),
  'DX-4': declaration(['view.run.roundNo']),
  'DX-5': declaration(['view.room.constraintsVersion']),
  'DX-6': declaration(['view.approvals.role', 'view.approvals.decision', 'view.approvals.boundConstraintsVersion', 'view.approvals.boundTermsKey', 'view.approvals.reasonKey']),
  'DX-7': declaration(['view.briefs.role', 'view.briefs.confirmed', 'view.briefs.version', 'view.briefs.confirmedAt']),
  'DX-8': declaration(['view.run.endedReason']),
  // Counter is not a proposal. Its only external signal is DX-11.
  'DX-9': declaration([]),
  'DX-10': declaration(['view.changeOrder.number', 'view.changeOrder.deltaCents', 'view.execution.amountCents', 'view.tasks']),
  'DX-11': declaration(['view.ownTurn.result.counterForwarded', 'context.feedback.outcome']),
  'DX-12': declaration(['answer.status']),
  'DX-13': declaration(['context.forwardedCandidate.optionKey', 'context.forwardedCandidate.terms']),
} satisfies Record<typeof DECLASSIFIED[number], ReturnType<typeof declaration>>);
export function declassified(boundary: Boundary) {
  return Object.fromEntries(DECLASSIFIED.map(dx => [dx, DECLASSIFIERS[dx].extract(boundary)]));
}

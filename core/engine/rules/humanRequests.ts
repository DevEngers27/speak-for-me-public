import type { ScenarioPlugin } from '../plugin';
import { buildHumanRequests as buildProtocolRequest, type RequestContext } from '../protocol/humanRequests';
import type { HumanRequestKind, RuleInputBase, View } from './types';
import { PluginContractError } from './types';
export type { HumanRequestDraft } from '../protocol/humanRequests';
/** Compatibility entry point for rules consumers; protocol owns request planning. */
export function buildHumanRequests<RI extends RuleInputBase>(p: ScenarioPlugin<RI>, x: {
  kind: HumanRequestKind; full: View<RI>; viewOf: (r: string) => View<RI>;
  run: Omit<RequestContext<RI>, 'plugin' | 'disclosures'> & { failedRole?: string };
  disclosures: Readonly<Record<string, readonly string[]>>;
}) {
  if (x.kind === 'agent_escalated' && !x.run.escalation) throw new PluginContractError('missing_escalation');
  if (x.kind === 'agent_failed' && !x.run.failedRole) throw new PluginContractError('missing_failed_role');

  const request = buildProtocolRequest(x.kind, x.run.failedRole ?? x.run.escalation?.toRole ?? p.protocol.counterRoles[0] ?? p.protocol.proposerRole, x.viewOf, {
    ...x.run, plugin: p, disclosures: x.disclosures,
  });
  return request;
}

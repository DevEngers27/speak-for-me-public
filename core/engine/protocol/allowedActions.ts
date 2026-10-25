import { allowedActionsFor } from '../actions';
import type { AgentAction, Role, TurnKind } from '../actions';

export type ActionCtx = {
  snapshotSize: number;
  clarifyUsedInRun: boolean;
  escalateUsedInRun: boolean;
  proposeCountInRun: number;
  counterCountInRun: number;
  providerRejectLocked: boolean;
  topicKeys: readonly string[];
};
export const MAX_PROPOSALS_PER_ROLE_PER_RUN = 4;
/** Filters the static role matrix using the base-excluded snapshot and current run. */
export function allowedActions(role: Role, kind: TurnKind, c: ActionCtx): readonly AgentAction[] {
  return allowedActionsFor(role, kind).filter(action => {
    switch (action) {
      case 'propose': return c.snapshotSize >= 1 && c.proposeCountInRun < MAX_PROPOSALS_PER_ROLE_PER_RUN;
      case 'counter': return c.snapshotSize >= 1 && c.counterCountInRun < MAX_PROPOSALS_PER_ROLE_PER_RUN;
      case 'clarify': return !c.clarifyUsedInRun && c.topicKeys.length > 0;
      case 'escalate': return !c.escalateUsedInRun;
      case 'reject': return !(role === 'provider' && c.providerRejectLocked);
      case 'recommend_accept': return true;
    }
  });
}

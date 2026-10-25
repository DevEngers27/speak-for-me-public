// 设计草案：代理上下文白名单。唯一入口 internal.agentContext.forTurn({ turnId })。
export type AgentContext = {
  protocol: { scenarioKey: string; protocolVersion: string; role: string; side: string;
              round: number; maxRounds: number; allowedActions: string[] };
  envelope: { turnSeq: number; constraintsVersion: number; baseProposalVersion: number | null };
  principal: { briefVersion: number; structured: Record<string, unknown>; notes: string };
  budget?: { totalCents: number; committedCents: number; headroomCents: number }; // 仅 buyer
  catalog: { itemKey: string; title: string; priceCents: number; earliestDeliveryDate: string }[];
  sharedFacts: { fromRole: string; field: string; value: string | string[] }[];
  currentProposal: ProposalForAgent | null;
  recentProposals: ProposalForAgent[];
  evaluation: { executable: boolean; blockedReasonCodes: string[]; budgetDetail?: unknown };
  candidates: { candidateKey: string; itemKeys: string[]; deferredItemKeys: string[];
                amountCents: number; earliestDeliveryDate: string }[];
  timeline: { type: string; text: string }[];
  openRequestsForMe: { requestId: string; kind: string; options: { key: string; label: string }[] }[];
  untrusted: { roomGoal: string };
};
export type ProposalForAgent = { version: number; authorRole: string; itemKeys: string[];
  deferredItemKeys: string[]; amountCents: number; deliveryDate: string; summary: string };

// 单测断言这些键路径在任何角色的上下文里都不出现
export const FORBIDDEN_IN_CONTEXT = ['displayName', 'userId', 'tokenIdentifier', 'note',
  'rationale', 'reason', 'tokenHash', 'inviteCode', 'anthropicRequestId'] as const;

// 组装步骤（伪代码）：
// const turn = db.get(turnId); assert(turn.status === 'running')
// const viewer = { role: turn.role, memberId: '(agent)', isOwner: false }
// principal  = briefVersions.by_room_role(turn.roomId, turn.role).latestConfirmed  —— 只读本角色
// budget     = isOnSide(viewer,'buyer') ? loadBuyerBudget(...) : undefined
// catalog    = offerItems confirmed，逐字段挑选
// sharedFacts= sharedFacts.by_room 中 ownerRole !== turn.role
// evaluation = projectEvaluation(evaluateProposal(fullInputs), viewer)
// candidates = enumerateCandidates(visibleInputsFor(viewer))   —— 不得传入不可见数据（part3 8.3）
// timeline   = events.by_room_seq desc take(20) → renderEventFor(viewer)
// 序列化：stableStringify；他方字符串 JSON 编码后进 <untrusted_text>

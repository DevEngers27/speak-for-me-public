// 设计草案：披露类注册表与动作矩阵（engine/privacy）。非最终实现。
export type RoleKey = string;               // 场景声明，如 'customer' | 'provider' | 'finance'
export type Audience =
  | { kind: 'room' }
  | { kind: 'roles'; roles: RoleKey[] }
  | { kind: 'self' }
  | { kind: 'owner' }
  | { kind: 'system' };

export type Viewer = { memberId: string; role: RoleKey; isOwner: boolean };

const room: Audience = { kind: 'room' };
const self: Audience = { kind: 'self' };
const owner: Audience = { kind: 'owner' };
const system: Audience = { kind: 'system' };
export const side = (roles: RoleKey[]): Audience => ({ kind: 'roles', roles });

// 首个场景：sides 由场景插件声明
export const SIDES = { buyer: ['customer', 'finance'], seller: ['provider'] } as const;
const buyer = side([...SIDES.buyer]);

// 'table.field' -> Audience。引擎表由引擎登记，场景字段由场景插件合并进来。
// 注册表完整性测试要求 schema 每个字段都在这里出现。
export const DISCLOSURE: Record<string, Audience> = {
  'rooms.title': room, 'rooms.goal': room, 'rooms.status': room, 'rooms.constraintsVersion': room,
  'rooms.proposalVersion': room, 'rooms.currentRunId': room, 'rooms.currentProposalId': room,
  'rooms.simulated': room, 'rooms.ownerUserId': system,
  'users.tokenIdentifier': system, 'users.displayName': room,
  'members.role': room, 'members.displayName': room, 'members.userId': system,
  'roomInvites.role': owner, 'roomInvites.expiresAt': owner, 'roomInvites.tokenHash': system,
  'briefVersions.structured': self, 'briefVersions.notes': self,
  'privateBriefs.status': room,                 // X6，他方只见 confirmed | not_confirmed
  'sharedFacts.value': room,
  'offerItems.priceCents': room,                // 仅 confirmed；draft 行整体为 self(provider)
  'offerItems.title': room, 'offerItems.confirmedByUserId': system,
  'proposals.amountCents': room, 'proposals.itemKeys': room,
  'approvals.decision': room, 'approvals.reasonCode': room,
  'approvals.note': self,                       // noteShared=true 时升为 room；任何情况下不进代理上下文
  'approvals.userId': system,
  'budgets.totalBudgetCents': buyer,
  'budgetChanges.newTotalCents': buyer, 'budgetChanges.oldTotalCents': buyer,
  'budgetChanges.reason': self,                 // ownerRole = finance
  'commitments.amountCents': buyer, 'changeOrders.amountCents': room,
  'changeOrders.operationId': system, 'tasks.title': room,
  'runs.status': room, 'runs.callCount': room,
  'agentTurns.status': room, 'agentTurns.output.action': room,
  'agentTurns.output.rationale': self, 'agentTurns.usage': self,
  'agentTurns.contextRef': self, 'agentTurns.anthropicRequestId': system,
  'humanRequests.targetRole': room, 'humanRequests.options': room, // 每个 option 另带 audience
  'events.payload': room,
};

// 派生值显式解密清单（part1 第 4 节）
export const DECLASSIFIED = ['proposal.executable', 'proposal.blockedReasonCodes',
  'room.constraintsVersion', 'run.endedReasonCode', 'humanRequest.existence',
  'brief.confirmedStatus'] as const;

export function canSee(v: Viewer, a: Audience, ownerRole?: RoleKey): boolean {
  switch (a.kind) {
    case 'room': return true;
    case 'roles': return a.roles.includes(v.role);
    case 'self': return ownerRole !== undefined && v.role === ownerRole;
    case 'owner': return v.isOwner;
    case 'system': return false;
  }
}

// 动作矩阵：'*' = 任意成员角色；guard 名对应 04/08 的守卫函数
type Rule = { roles: RoleKey[] | '*' | 'self' | 'targetRole' | 'requiredApprover';
              ownerOnly?: boolean; nonMember?: 'allow' | 'deny'; agent: false; guards: string[] };
export const ACTION_MATRIX: Record<string, Rule> = {
  'rooms.create':          { roles: '*', nonMember: 'allow', agent: false, guards: ['creatorAllowlisted'] },
  'rooms.close':           { roles: '*', ownerOnly: true, agent: false, guards: ['noActiveRun'] },
  'invites.create':        { roles: '*', ownerOnly: true, agent: false, guards: ['roleVacant'] },
  'invites.accept':        { roles: '*', nonMember: 'allow', agent: false,
                             guards: ['codeValid', 'notExpired', 'roleVacant', 'notAlreadyMember'] },
  'briefs.saveDraft':      { roles: 'self', agent: false, guards: [] },
  'briefs.confirm':        { roles: 'self', agent: false, guards: ['bumpConstraintsIfHardChanged'] },
  'offerItems.confirm':    { roles: ['provider'], agent: false, guards: ['bumpConstraints'] },
  'budgets.update':        { roles: ['finance'], agent: false, guards: ['assertCents', 'bumpConstraints'] },
  'negotiation.start':     { roles: '*', agent: false, guards: ['allBriefsConfirmed', 'noActiveRun', 'callLimit'] },
  'runs.retryTurn':        { roles: '*', agent: false, guards: ['runFailed', 'cooldown', 'callLimit'] },
  'runs.cancel':           { roles: '*', ownerOnly: true, agent: false, guards: [] },
  'approvals.decide':      { roles: 'requiredApprover', agent: false,
                             guards: ['runPendingApproval', 'isCurrentProposal', 'constraintsCurrent'] },
  'approvals.withdraw':    { roles: 'self', agent: false, guards: ['notExecuted'] },
  'humanRequests.answer':  { roles: 'targetRole', agent: false, guards: ['requestOpen', 'constraintsCurrent'] },
  'tasks.updateStatus':    { roles: ['provider'], agent: false, guards: ['isAssigneeRole'] },
  'usage.roomSummary':     { roles: '*', ownerOnly: true, agent: false, guards: [] },
};

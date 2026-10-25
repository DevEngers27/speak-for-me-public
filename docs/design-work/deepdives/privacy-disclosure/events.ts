// 设计草案：events 存储与读取（Convex validator）。无 visibility 字段；payload 只含 room 类字段。
import { v } from 'convex/values';

export const eventPayloadV = v.union(
  v.object({ type: v.literal('constraints_changed'),
    constraintKind: v.union(v.literal('budget'), v.literal('brief'), v.literal('catalog')),
    fromVersion: v.number(), toVersion: v.number(), invalidatedApprovalCount: v.number() }),
  v.object({ type: v.literal('proposal_blocked'),
    proposalVersion: v.number(), amountCents: v.number(), reasonCodes: v.array(v.string()) }),
  v.object({ type: v.literal('request_opened'),
    targetRole: v.string(), kind: v.union(v.literal('tradeoff'), v.literal('clarify')) }),
  v.object({ type: v.literal('executed'),
    proposalVersion: v.number(), amountCents: v.number(), taskCount: v.number() }),
  // ... 其余 type 见 part4 10.4
);

export const eventDocV = v.object({
  roomId: v.id('rooms'),
  seq: v.number(),
  actor: v.union(
    v.object({ kind: v.literal('user'), role: v.string() }),
    v.object({ kind: v.literal('agent'), role: v.string() }),
    v.object({ kind: v.literal('system') }),
  ),
  payload: eventPayloadV,
  restrictedRef: v.optional(v.union(
    v.object({ table: v.literal('budgetChanges'), id: v.id('budgetChanges') }),
    v.object({ table: v.literal('humanRequests'), id: v.id('humanRequests') }),
    v.object({ table: v.literal('agentTurns'), id: v.id('agentTurns') }),
  )),
  constraintsVersion: v.number(),
  proposalId: v.optional(v.id('proposals')),
  runId: v.optional(v.id('runs')),
  createdAt: v.number(),
});

// 客户端只见 EventView：{ id, type, at, actor, text, refs }，从不含 payload / restrictedRef
export const eventViewV = v.object({
  id: v.id('events'), type: v.string(), at: v.number(),
  actor: v.string(), text: v.string(),
  refs: v.object({ proposalVersion: v.optional(v.number()), runId: v.optional(v.id('runs')) }),
});

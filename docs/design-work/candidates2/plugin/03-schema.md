# 03 Convex schema v1（part1：表定义）

> 约定：`v` 管存储与函数参数，Zod 只管插件 payload 与模型 I/O（F03.13）。`unknownPayload = v.any()` 的字段一律由插件 Zod 在唯一写入口校验后写入。时间戳 `v.number()`（ms）。日期 `YYYY-MM-DD` 字符串。`convex/` 内不用 `@/` 别名。

```ts
// convex/schema.ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { runStatus, turnStatus, proposalStatus, decisionValue, requestStatus, eventType, audience,
         actorKind, approvalKind, entryStatus, ledgerEntryKind } from './lib/validators';

const roleKey = v.string();            // 由插件声明；写入口校验 ∈ plugin.roles
const unknownPayload = v.any();

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(), displayName: v.string(), createdAt: v.number(),
  }).index('by_token', ['tokenIdentifier']),

  rooms: defineTable({
    scenarioKey: v.string(), scenarioVersion: v.number(),
    title: v.string(), goal: v.string(),
    status: v.union(v.literal('open'), v.literal('closed')),
    timeZone: v.string(),                       // IANA，如 'America/Los_Angeles'
    constraintsVersion: v.number(), proposalSeq: v.number(),
    currentRunId: v.optional(v.id('runs')), currentProposalId: v.optional(v.id('proposals')),
    simulated: v.boolean(), fixtureKey: v.optional(v.string()),
    createdBy: v.id('users'), createdAt: v.number(),
  }).index('by_creator', ['createdBy']),

  participants: defineTable({
    roomId: v.id('rooms'), userId: v.id('users'), roleKey, displayName: v.string(), joinedAt: v.number(),
  }).index('by_room_role', ['roomId', 'roleKey'])
    .index('by_room_user', ['roomId', 'userId'])
    .index('by_user', ['userId']),

  invites: defineTable({
    roomId: v.id('rooms'), roleKey, tokenHash: v.string(), expiresAt: v.number(),
    createdBy: v.id('users'), acceptedBy: v.optional(v.id('users')), acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  }).index('by_token_hash', ['tokenHash']).index('by_room_role', ['roomId', 'roleKey']),

  briefDrafts: defineTable({
    roomId: v.id('rooms'), roleKey, userId: v.id('users'),
    payload: unknownPayload, disclosedFields: v.array(v.string()), updatedAt: v.number(),
  }).index('by_room_role', ['roomId', 'roleKey']),

  briefVersions: defineTable({
    roomId: v.id('rooms'), roleKey, userId: v.id('users'), version: v.number(),
    payload: unknownPayload, hardKey: v.string(),
    disclosedFields: v.array(v.string()),       // 本人逐项勾选 + 插件 mandatoryFor 字段
    constraintsVersionAfter: v.number(), confirmedAt: v.number(), simulated: v.boolean(),
  }).index('by_room_role_version', ['roomId', 'roleKey', 'version']),

  catalogEntries: defineTable({
    roomId: v.id('rooms'), entryKey: v.string(), revision: v.number(), authorRole: roleKey,
    status: entryStatus,                         // 'unconfirmed' | 'confirmed' | 'retired'
    payload: unknownPayload, createdBy: v.id('users'), confirmedAt: v.optional(v.number()),
    simulated: v.boolean(),
  }).index('by_room_entry_rev', ['roomId', 'entryKey', 'revision'])
    .index('by_room', ['roomId']),

  ledgerAccounts: defineTable({
    roomId: v.id('rooms'), accountKey: v.string(), ownerRole: roleKey,
    capCents: v.number(), currency: v.string(), updatedAt: v.number(),
  }).index('by_room_account', ['roomId', 'accountKey']),

  ledgerCapChanges: defineTable({
    roomId: v.id('rooms'), accountId: v.id('ledgerAccounts'), oldCapCents: v.number(), newCapCents: v.number(),
    actorUserId: v.id('users'), reason: v.string(), constraintsVersionAfter: v.number(),
    via: v.union(v.literal('direct'), v.literal('human_request')), createdAt: v.number(),
  }).index('by_account', ['accountId']),

  ledgerEntries: defineTable({
    roomId: v.id('rooms'), accountId: v.id('ledgerAccounts'), kind: ledgerEntryKind, // baseline|execution|external
    amountCents: v.number(), label: v.string(), executionId: v.optional(v.id('executions')),
    simulated: v.boolean(), createdAt: v.number(),
  }).index('by_account', ['accountId']).index('by_execution', ['executionId']),

  runs: defineTable({
    roomId: v.id('rooms'), status: runStatus,
    trigger: v.union(v.literal('initial'), v.literal('constraints_changed'), v.literal('human_answer'),
                     v.literal('renegotiate')),
    constraintsVersionAtStart: v.number(), round: v.number(), maxRounds: v.number(),
    nextTurnSeq: v.number(), pendingTurnSeqs: v.array(v.number()), callCount: v.number(), callLimit: v.number(),
    endedReason: v.optional(v.string()), startedBy: v.union(v.id('users'), v.literal('system')),
    createdAt: v.number(), endedAt: v.optional(v.number()),
  }).index('by_room', ['roomId']),

  turns: defineTable({
    roomId: v.id('rooms'), runId: v.id('runs'), turnSeq: v.number(), round: v.number(), roleKey,
    kind: v.union(v.literal('propose'), v.literal('evaluate')), attempt: v.number(),
    mode: v.union(v.literal('model'), v.literal('stub')), status: turnStatus,
    constraintsVersion: v.number(), proposalId: v.optional(v.id('proposals')),   // evaluate 时被评估的提案
    candidateKeys: v.array(v.string()),
    output: v.optional(v.any()),                 // 校验后的模型输出（含私密 rationale），只给本方
    resultProposalId: v.optional(v.id('proposals')),
    model: v.optional(v.string()), effort: v.optional(v.string()), stopReason: v.optional(v.string()),
    inputTokens: v.optional(v.number()), cacheReadTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()), outputTokens: v.optional(v.number()),
    thinkingTokens: v.optional(v.number()), requestId: v.optional(v.string()), latencyMs: v.optional(v.number()),
    errorCode: v.optional(v.string()), scheduledFnId: v.optional(v.id('_scheduled_functions')),
    startedAt: v.number(), finishedAt: v.optional(v.number()),
  }).index('by_run_seq_attempt', ['runId', 'turnSeq', 'attempt']).index('by_room', ['roomId']),

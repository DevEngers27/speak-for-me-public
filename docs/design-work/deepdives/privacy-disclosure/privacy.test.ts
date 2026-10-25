// 设计草案：金丝雀与矩阵驱动测试骨架（convex-test 风格，API 细节待验证）。
import { DISCLOSURE, ACTION_MATRIX } from './disclosure';

export const CANARY = {
  cusNotes: 'CANARY-CUS-NOTES-7f3a', proNotes: 'CANARY-PRO-NOTES-91bc', finNotes: 'CANARY-FIN-NOTES-2d0e',
  finReason: 'CANARY-FIN-REASON-55aa', cusNote: 'CANARY-CUS-NOTE-c41d',
  cusDeadline: '2027-03-17', cusItem: 'CANARYITEM',
  capCents: 481_237, baselineCents: 400_013,               // 派生：headroom 81_224
};

export function numberForms(cents: number): string[] {
  const d = Math.trunc(cents / 100), c = String(cents % 100).padStart(2, '0');
  const comma = d.toLocaleString('en-US');
  return [String(cents), `${d}.${c}`, `${comma}.${c}`, `$${comma}.${c}`, String(d), comma];
}

export function assertNoLeak(label: string, payload: unknown, forbidden: string[]): void {
  const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const f of forbidden) if (s.includes(f)) throw new Error(`leak:${label}`); // 不打印命中内容本身
}

export function providerForbidden(): string[] {
  const budgetDerived = [CANARY.capCents, CANARY.baselineCents, CANARY.capCents - CANARY.baselineCents];
  return [CANARY.cusNotes, CANARY.finNotes, CANARY.finReason, CANARY.cusNote,
          CANARY.cusDeadline, CANARY.cusItem, ...budgetDerived.flatMap(numberForms)];
}

// 用例清单（实现时展开为 test(...)）：
// 1. seed('canary') → 跑 stub 协商到 pending_approval → finance 降预算 → 重谈 → 执行
// 2. 以 provider 身份调用 rooms.view / events.list(全部页) / agentTurns.mine → assertNoLeak(providerForbidden())
// 3. internal.agentContext.forTurn(providerTurn) → stableStringify → assertNoLeak
// 4. 记录型假 Anthropic 客户端：provider 回合请求体 → assertNoLeak
// 5. room 类表全部行（proposals、events.payload、changeOrders、tasks、sharedFacts、runs）→ 扫全部金丝雀
// 6. console spy + 收集 ConvexError.data → 扫全部金丝雀与预算数值
// 7. for (const [fn, rule] of Object.entries(ACTION_MATRIX)) for (const who of IDENTITIES) 期望 allow/deny
// 8. Object.keys(DISCLOSURE) ⊇ schema 全部 'table.field'（内省 API 待验证）
// 9. 对抗型 stub 代理（J5）：rationale = 整个上下文；结构化字段塞非法值 → invalid_output，他方零命中
void DISCLOSURE; void ACTION_MATRIX;

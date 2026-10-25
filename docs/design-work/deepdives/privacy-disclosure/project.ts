// 设计草案：服务端投影。品牌类型保证 DTO 构造函数只接受已投影部件。
import type { Audience, Viewer } from './disclosure';
import { canSee } from './disclosure';

declare const projected: unique symbol;
export type Projected<T> = T & { readonly [projected]: true };

// 06 的评估结果：每个明细带 audience
export type EvalDetail<T> = { value: T; audience: Audience; ownerRole?: string };
export type Evaluation = {
  executable: boolean;                       // 解密 X1
  blockedReasonCodes: string[];              // 解密 X2
  budgetDetail?: EvalDetail<{ totalCents: number; committedCents: number;
    afterApprovalCents: number; headroomCents: number; overByCents: number }>;
  missingItemKeys?: EvalDetail<string[]>;    // self(customer)，若已共享则 room
  deadline?: EvalDetail<string>;
};

export function projectEvaluation(e: Evaluation, v: Viewer): Projected<{
  executable: boolean; blockedReasonCodes: string[];
  budgetDetail?: NonNullable<Evaluation['budgetDetail']>['value'];
  missingItemKeys?: string[]; deadline?: string;
}> {
  const pick = <T>(d?: EvalDetail<T>) => (d && canSee(v, d.audience, d.ownerRole) ? d.value : undefined);
  return {
    executable: e.executable,
    blockedReasonCodes: e.blockedReasonCodes,
    budgetDetail: pick(e.budgetDetail),
    missingItemKeys: pick(e.missingItemKeys),
    deadline: pick(e.deadline),
  } as Projected<any>;
}

// rooms.view 的处理顺序（见 part3 7.1）：
// 1) getViewer → null 则返回 null
// 2) loadRoomPublic(ctx, roomId)            只读 room 类数据
// 3) loadEvaluationInputs → evaluateProposal → projectEvaluation（原始 Evaluation 不外流）
// 4) 仅 buyer 侧执行 loadBuyerBudget（provider 路径不读 budgets）
// 5) toRoomView(parts, viewer)：逐字段挑选，禁止 ...spread
export type RoomViewParts = {
  pub: Projected<unknown>;
  evaluation: ReturnType<typeof projectEvaluation>;
  buyer?: Projected<{ totalCents: number; committedCents: number; headroomCents: number }>;
};

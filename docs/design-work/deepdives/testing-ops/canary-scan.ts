// 示例：convex/test/canary.ts + scripts/probes/canary-scan.ts 共用的纯函数（§3.8、TD-5）。
// 纯函数，无 Convex 依赖；L0 自测（含"故意泄露必须报出"的正向用例）。

export type Role = "customer" | "provider" | "finance";

export type Canary = {
  owner: Role;
  label: string;
  text?: string;   // 文本金丝雀，如 "CANARY-FIN-7731"
  cents?: number;  // 数值金丝雀，如 481_731
  isoDate?: string; // 日期金丝雀，如 "2026-12-19"
};

export const SCOPE_CHANGE_CANARIES: readonly Canary[] = [
  { owner: "finance", label: "finance.cap", text: "CANARY-FIN-7731", cents: 481_731 },
  { owner: "customer", label: "customer.hardDeadline", text: "CANARY-CUS-2209", isoDate: "2026-12-19" },
  { owner: "provider", label: "provider.internalCost", text: "CANARY-PRV-5518", cents: 33_317 },
];

/** 把一个金丝雀展开成所有需要匹配的字符串形态（反例 X3）。 */
export function canaryNeedles(c: Canary): string[] {
  const out: string[] = [];
  if (c.text) out.push(c.text);
  if (c.isoDate) out.push(c.isoDate);
  if (c.cents !== undefined) {
    const dollars = c.cents / 100;
    const fixed = dollars.toFixed(2); // "4817.31"
    const grouped = dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // "4,817.31"
    const whole = Math.floor(dollars);
    out.push(
      String(c.cents),                       // "481731"
      fixed,
      grouped,
      `$${grouped}`,
      `$${whole.toLocaleString("en-US")}`,   // "$4,817"
    );
  }
  return [...new Set(out)];
}

/** 允许出现位置：与 07 的披露矩阵同源导入（这里只示意形状）。 */
export type AllowedLocation = {
  surface: "table" | "query" | "agentContext" | "ws" | "log" | "html";
  name: string;        // 表名 / query 名 / 角色上下文名
  field?: string;      // 表字段路径
  viewerRole?: Role;   // 该位置的查看者
  owner: Role;         // 允许出现的金丝雀所属角色
};

export type ScanTarget = {
  surface: AllowedLocation["surface"];
  name: string;
  field?: string;
  viewerRole?: Role;
  content: string; // 已序列化的 JSON / 文本
};

export type CanaryHit = { canary: string; needle: string; target: Omit<ScanTarget, "content"> };

function allowed(hitOwner: Role, t: ScanTarget, allowlist: readonly AllowedLocation[]): boolean {
  return allowlist.some(
    (a) =>
      a.owner === hitOwner &&
      a.surface === t.surface &&
      a.name === t.name &&
      (a.field === undefined || a.field === t.field) &&
      (a.viewerRole === undefined || a.viewerRole === t.viewerRole),
  );
}

/** 返回白名单之外的全部命中；空数组 = 通过。 */
export function scanForCanaries(
  targets: readonly ScanTarget[],
  canaries: readonly Canary[],
  allowlist: readonly AllowedLocation[],
): CanaryHit[] {
  const hits: CanaryHit[] = [];
  for (const t of targets) {
    for (const c of canaries) {
      if (t.viewerRole === c.owner) continue; // 本人看到自己的私密值是合法的
      for (const needle of canaryNeedles(c)) {
        if (t.content.includes(needle) && !allowed(c.owner, t, allowlist)) {
          const { content: _omit, ...where } = t;
          hits.push({ canary: c.label, needle, target: where });
        }
      }
    }
  }
  return hits;
}

/**
 * fixture 自检（反例 X4）：数值金丝雀不能等于任何目录价、子集和、或上限差，
 * 否则合法派生值会触发误报。catalogCents 为目录全部价格。
 */
export function assertCanariesDistinct(canaries: readonly Canary[], catalogCents: readonly number[], otherLegalCents: readonly number[]): void {
  const legal = new Set<number>(otherLegalCents);
  const n = catalogCents.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += catalogCents[i]!;
    legal.add(sum);
  }
  for (const c of canaries) {
    if (c.cents !== undefined && legal.has(c.cents)) {
      throw new Error(`canary ${c.label} collides with a legal derived amount`);
    }
  }
}

// 示例：convex/test/scriptedModel.ts —— 模型接缝的脚本化替身（TD-3）。
// 用法：vi.mock("../agentRuntime/modelClient", () => scriptedModelModule)
// callModel 的请求 / 结果类型以 10-agent-runtime 为准；这里只示意必须覆盖的分支。

export type StopReason = "end_turn" | "max_tokens" | "refusal" | "tool_use" | "pause_turn" | "stop_sequence";

export type ModelCallRequest = {
  role: "customer" | "provider" | "finance";
  turnSeq: number;
  attempt: number;
  body: unknown; // 发给 SDK 的完整请求体（供金丝雀扫描）
};

export type ScriptedResponse =
  | { kind: "ok"; stopReason: StopReason; text: string; usage?: Partial<Usage> }
  | { kind: "throw"; errorCode: "timeout" | "rate_limited" | "server_error" | "bad_request" }
  | { kind: "beforeReturn"; run: () => Promise<void>; then: ScriptedResponse }; // 调用中插入副作用（§3.5 测法 2）

export type Usage = {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
};

const queue = new Map<string, ScriptedResponse[]>();
export const recordedRequests: ModelCallRequest[] = [];

const key = (role: string, turnSeq: number) => `${role}#${turnSeq}`;

export function enqueue(role: ModelCallRequest["role"], turnSeq: number, ...responses: ScriptedResponse[]): void {
  const k = key(role, turnSeq);
  queue.set(k, [...(queue.get(k) ?? []), ...responses]);
}

export function resetScript(): void {
  queue.clear();
  recordedRequests.length = 0;
}

async function play(r: ScriptedResponse) {
  if (r.kind === "beforeReturn") {
    await r.run();
    return play(r.then);
  }
  if (r.kind === "throw") {
    const err = new Error(`scripted ${r.errorCode}`) as Error & { scriptedCode: string };
    err.scriptedCode = r.errorCode;
    throw err;
  }
  return {
    stopReason: r.stopReason,
    content: r.text.length ? [{ type: "text" as const, text: r.text }] : [],
    usage: { inputTokens: 1000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 200, thinkingTokens: 100, ...r.usage },
    model: "scripted",
    requestId: `req_scripted_${recordedRequests.length}`,
    latencyMs: 1,
  };
}

export const scriptedModelModule = {
  async callModel(req: ModelCallRequest) {
    recordedRequests.push(req);
    const list = queue.get(key(req.role, req.turnSeq));
    const next = list?.shift();
    if (!next) throw new Error(`script exhausted for ${key(req.role, req.turnSeq)}`); // 防止悄悄走到未定义分支
    return play(next);
  },
};

// 必须覆盖的脚本（L1 RUN / STALE 组）：
// - ok + end_turn + 合法 JSON                → 提案
// - ok + max_tokens + 半截 JSON              → invalid_output，自动重试 1 次
// - ok + refusal + 空 content                → invalid_output / failed，绝不当作"无动作"
// - ok + end_turn + 含 priceCents 字段        → Zod 拒绝（INJ-03）
// - ok + end_turn + rationale 含 "$4,817.31"  → 他方视图零命中（INJ-02）
// - throw timeout                             → failTurn，可 retryTurn
// - beforeReturn(updateBudget) + ok           → stale（§3.5 测法 2）

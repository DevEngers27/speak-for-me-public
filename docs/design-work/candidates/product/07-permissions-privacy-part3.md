# 07 权限与隐私（part3）：代理上下文、公开文本、事件与日志、威胁模型、数据保留

## 7.7 代理上下文组装与对他方可见文本

### 唯一入口：`runtime.getTurnInput`（internal query）

```ts
// convex/runtime/turnInput.ts —— 显式白名单，逐字段构造，禁止 spread 文档
export interface AgentContextData<T> {
  envelope: AgentEnvelope;                                   // 来自 turn 行
  room: { title: string; goal: string; today: IsoDate; timeZone: string; currency: "USD" };
  me: { roleKey: string; roleLabel: string };
  ownBrief: { version: number; fields: T["briefFields"][string]; notes: string; sharedNote: string };
  sharedFacts: { fromRoleKey: string; fieldKey: string; valueText: string }[];   // 只含披露给本席位的
  sharedTexts: { fromRoleKey: string; text: string }[];      // 他方披露给本席位的共享说明（不可信）
  lists: Record<string, { itemKey: string; version: number; data: unknown; expired: boolean }[]>; // 公开
  current: null | { version: number; candidateKey: string; terms: T["terms"]; checks: ProjectedCheck[] };
  candidates: { key: string; label: string; terms: T["terms"]; knownChecks: ProjectedCheck[];
                unknownCheckIds: string[] }[];               // 作用域视图，≤ 40 个
  history: {
    proposals: { version: number; candidateKey: string; authorRoleKey: string; status: string }[];
    stances: { round: number; roleKey: string; action: string; candidateKeys?: string[]; reasonCode?: string }[];
    humanDecisions: { roleKey: string; proposalVersion: number; kind: string; reasonCode?: string }[];
    ownRejectionNotes: string[];                             // 只有本席位人写的拒绝备注
    answeredRequests: { kind: string; topicKey?: string; outcome: string }[];
  };
  feedback: null | { blocked: { candidateKey: string; reasonCodes: string[] }[] }; // a2 时
  constraintNotice: null | { fromVersion: number; toVersion: number; causeRoleKey?: string; publicReasonCode?: string };
}
```

- 组装步骤：`buildRuleView` → `scopeView(view, roleKey, disclosures)` → 用作用域视图枚举候选与投影检查 → 逐字段填入上面的结构。完整视图只用于判断，不进入结构。
- `plugin.agent.describe(data)` 把结构排版为文本；插件拿不到结构之外的数据（06 第 6.13 节）。
- 单测：为三方简报与台账植入金丝雀值（`CANARY-FIN-7731` 等），断言 provider 回合的 `AgentContextData` 序列化与最终请求体中都不出现 customer/finance 的金丝雀（16）。
- 代码审查规则：`convex/runtime/` 下禁止按 `roomId` 整表 `collect()` 再在 JS 中过滤私密表（`briefVersions`、`briefDrafts`）。

### 对他方可见的文本（ADR-11）

1. 存储的是结构化数据（事件 `data`、提案 `terms`、检查 `reasonCode`），**不存渲染后的文本**；query 按查看者的角色、披露与语言调用模板渲染（RA-T02）。
2. 模板输入只能是：枚举、ID、版本号、公开金额与日期、已投影的派生事实。同一事件对不同查看者措辞不同（例如 `constraints_changed` 对 finance 渲染为 "You lowered the cap $5,000 → $4,800"——数值来自 finance 自己可见的简报版本；对他方渲染为 "Finance updated their constraints (budget revision)"）。
3. 代理 rationale 只对本席位可见，不进入其他代理上下文，也不出现在任何公共渲染中。
4. 唯一跨席位的自由文本是人亲自写并选择披露的 `sharedNote` 与清单项的标题/描述（公开清单本就由人填写）；它们进入他方代理上下文时位于不可信定界块。
5. 不采用"在模型自由文本中正则扫描金额"作为主防线（F05.3：写法无穷、误伤公开报价、会卡住流程）。

## 7.8 事件可见性、日志与错误信息纪律

| 项 | 规则 |
| --- | --- |
| 事件受众 | 默认 `room`；payload 不含私密值（I-32），所以全房间可见是安全的。只给目标席位的信息（请求选项、被阻断原因、rationale）不做成事件，而放在本就按席位控制的表（`humanRequests`、`turns`） |
| 事件读取 | `history.timeline` 按 `by_room_order` 分页读取后，在服务端按受众过滤，再渲染；未过滤结果从不离开 query |
| 服务器日志 | 不 `console.log` 简报、提示、模型原文、令牌、邀请链接；只记 `roomId`、`runId`、`turnId`、`seq`、`attempt`、`errorCode`、token 数、`latencyMs`。lint 规则禁止在 `convex/runtime/` 中记录名为 `prompt`/`brief`/`notes`/`text` 的变量 |
| 客户端错误 | 一律 `throw new ConvexError({ code, params? })`；`params` 只含公开值（版本号、候选键）；生产部署隐藏非 ConvexError 消息作为兜底 |
| 结构化追溯 | 谁在何时用了多少 token、哪次调用失败，靠 `turns` 的结构化字段，不靠日志正文 |
| 例行核查 | 在 Convex 日志与导出的事件中搜索金丝雀与 fixture 预算数字，应零命中（15） |

## 7.9 威胁模型

| # | 威胁 | 主要对策 | 验证（16） |
| --- | --- | --- | --- |
| T1 | 越权读：provider 直接调用读取 finance 简报的函数，或从 `rooms.workspace`/WebSocket 负载拿到预算 | 无"读他人简报"的函数；投影 + `returns` 校验器；query 只按 `(roomId, 当前用户)` 取本席位 | 以 provider 身份调用全部 query，断言无金丝雀、无预算字段 |
| T2 | 自封角色 / 一人多席满足"三方批准" | 邀请绑定席位；一人一席；执行时断言不同 userId | 负面用例 |
| T3 | 代理泄露**自己委托人**的私密值（主泄露路径） | 代理输出只有结构化动作，公共文本只由模板生成；rationale 不外流 | 金丝雀扫描公共事件与他方负载 |
| T4 | 跨代理提示注入 | 他方代理输出只以结构化立场进入；人写的共享文本在定界块；运营指令走中途 system 消息 | 注入用例 |
| T5 | 模型伪造金额、日期、来源或身份 | 输出 schema 不含这些字段；代码重算条款；`terms_consistent` 检查 | 规则单测 |
| T6 | 过期结果覆盖新状态 | G-PERSIST；约束递增使 run superseded | 回合进行中改预算的集成测试 |
| T7 | 重复执行 / 并发双签 | 状态守卫 + `operationKey`；签核区间读触发 OCC | 真实部署并发脚本 |
| T8 | 费用滥用（反复触发模型） | 只有成员能触发；每房间每小时触发上限、每 run 与每日调用上限；`AGENTS_ENABLED` 总开关；供应商侧花费上限 | 限流用例 |
| T9 | 邀请链接泄露 | 单次使用、7 天过期、只存哈希、可撤销；接受者看到角色与房间后再确认 | 用例 |
| T10 | 日志与错误消息泄露数字 | 7.8 纪律 + 例行扫描 | 日志扫描脚本 |
| T11 | 推断泄露（可行性信号） | 7.6 的上界与频率限制 | 计数断言 |
| T12 | 配置半残导致放行（proxy fail-open、密钥格式错误） | auth.config fail-closed；托管环境缺配置返回 503；`/admin/health` 区分"已配置"与"可用" | 冒烟 |
| T13 | 导出文件公式注入 | v1 只提供页面/打印视图；将来 CSV 导出对 `= + - @ \t \r` 开头的单元格加前缀（17） | — |

## 7.10 数据保留与模型提供方

- 服务端处理简报；不承诺端到端加密或"数据不出设备"。授权给本方代理的上下文会被服务端发送给 Anthropic API（P-11），产品隐私说明在首次确认简报前展示。
- 模型提供方对 API 数据的保留与训练使用政策以签约条款为准（待验证，GAP-23）；不在系统中写入任何未经核实的承诺。
- 保留：房间关闭后数据只读保留；v1 不提供硬删除（与"历史不可篡改"冲突）。账户删除与数据导出的合规流程列为开放问题（18），届时以"清除私密字段内容、保留结构与哈希"的方式实现，不破坏审计链。
- 模拟房间（`isSimulated`）可以在开发部署中按 `fixtureKey` 清理（15）。

# 07 权限与隐私（part3）：日志与错误纪律、威胁模型、数据保留

> 分片清单见 part1。

## 7.9 日志与错误信息纪律

| 场合 | 允许 | 禁止 |
| --- | --- | --- |
| Convex 函数日志（`console.*`） | 结构化白名单字段：id、状态、outcome 种类、HTTP 状态、token 数、耗时、重试类别（10 part6 §10.23） | 提示、上下文、模型输出、简报字段、金额、日期、令牌、错误对象整体序列化 |
| 面向客户端的错误 | `throw new ConvexError({ code, params? })`；`params` 只能含调用者本人有权看到的值（例如只有 finance 会触发的 `BUDGET_INPUT_INVALID` 可以带上限） | 他方私密值；内部异常消息（生产部署会隐藏非 ConvexError 消息，作为第二层兜底） |
| 事件、请求、检查的文本 | 模板 + 受众内可见的参数 | 模型自由文本 |
| 模型尝试记录 | outcome 种类、错误名、HTTP 状态、requestId、截断到 200 字符且去掉 URL 查询串的错误摘要 | SDK 错误对象原文（可能含请求片段） |

代码审查清单（写入 CONTRIBUTING）："no console.log of briefs, prompts, or model output"；"no db doc spread into a return value"；"every public function starts with an auth helper"。15 §15.5 的例行检查在 Convex 日志中搜索金丝雀串与 fixture 中的预算数字，应零命中。

错误码表（`convex/lib/errors.ts`）：`UNAUTHENTICATED`、`NOT_PARTICIPANT`、`FORBIDDEN_ROLE`、`ROOM_CLOSED`、`NOT_FOUND`、`NOT_READY`、`STALE_VIEW`、`NOT_CURRENT`、`INVALID_STATE`、`NOT_EXECUTABLE`、`ALREADY_EXECUTED`、`VALIDATION_FAILED`、`LIMIT_EXCEEDED`、`INVITE_INVALID`、`ROLE_TAKEN`、`ALREADY_PARTICIPANT`、`AGENTS_UNAVAILABLE`。

## 7.10 威胁模型

| # | 威胁 | 攻击路径 | 对策 | 验证 |
| --- | --- | --- | --- | --- |
| T-01 | 越权读取私密简报或预算 | 直接调用 query、读 WebSocket 负载、预取的 RSC payload | 投影在 query 内完成；所有 query 以 `requireParticipant` 开头；`returns` validator；Next 只渲染 Convex 投影后的数据 | PV-01…PV-04 |
| T-02 | 自选角色、一人多角凑齐审批 | 猜 roomId 加入；重复接受邀请 | 角色只经邀请授予；(room, role) 与 (room, user) 唯一；执行要求不同 userId | AU-05、AP-04 |
| T-03 | 代理泄露**自己委托人**的私密值（主泄露路径，F05.3） | 模型在公开文本里写出上限或截止日 | 模型自由文本只给本方；他方可见文本只由模板生成；理由码是固定词表 | PV-05（全流程后扫描他方可见数据） |
| T-04 | 跨代理提示注入 | 一方在自由文本里写指令，进入另一方代理上下文 | 他方的自由文本（备注、rationale）从不进入上下文；进入上下文的他方文本只有目录标题与 requestedItems 标题（≤ 80 字符、数据标签内、声明不可信）；输出被枚举约束只能选合法候选 | PV-06、PV-07 |
| T-05 | 数字出现在日志、错误、事件里 | 调试日志、异常消息 | 7.9 纪律；事件受众断言 | PV-08（日志扫描） |
| T-06 | 费用滥用 | 反复开始协商、拒绝、重谈 | 房间创建策略；四级调用预算；拒绝循环上限；总开关；供应商侧花费上限 | RT-15、RT-16、RT-22 |
| T-07 | 批准自己没看到的版本 | 界面停留在旧版本时点击批准 | `decide` 必须带 `expectedConstraintsVersion` 与 `expectedTermsKey`，不一致返回 `STALE_VIEW` | AP-06 |
| T-08 | 由可行性推断他方约束 | 观察候选集合、阻断结论 | 接受为最小披露并写入委托条款；数值不进入他方上下文与视图 | 文档化（无测试可消除） |
| T-09 | 邀请链接被转发或重放 | 链接泄露 | 单次使用、7 天过期、哈希存储、创建者可撤销；接受者身份写入记录 | AU-06 |
| T-10 | 导出文件的公式注入 | 目录标题以 `=`、`+`、`-`、`@` 开头 | v1 只提供页面与打印视图；若做 CSV，以上字符及 `\t`、`\r` 开头的单元格加 `'` 前缀 | EX-01 |
| T-11 | 配置半残导致放行或全站 500 | 缺 Clerk key 时 proxy 放行；key 格式错误 | proxy 缺配置返回 503；`isClerkConfigured()` 做格式校验（pk_/sk_ 前缀、test/live 一致、Convex URL 为 `.convex.cloud` 或 localhost）；Convex 缺 issuer 时推送失败 | OP-02 |
| T-12 | 测试能力出现在生产 | 故障注入、seed、reset 被调用 | 只有 internal 函数；`ALLOW_FAULT_INJECTION` 在生产必须为 false（部署检查） | OP-03 |
| T-13 | 模型提供方侧的数据处理 | 私密简报随请求发往提供方 | 不宣称端到端加密或零泄露（P-11）；产品隐私说明如实告知；提供方的数据保留与训练政策待确认（GAP-23） | 文档化 |

## 7.11 数据保留与删除（GAP-21）

- 历史不可篡改（核心 6）与"私密简报可删除"之间的取舍：v1 不提供删除单条历史记录的功能；房间关闭后数据冻结保留。
- 提供**整房间删除**的运维函数 `ops.purgeRoom`（internal，经 CLI，需要房间创建者的书面请求），按 `by_room` 级联删除该房间全部表行，并在 `purgeLog`（只含 roomId、时间、操作者）里留痕。这是唯一的删除路径，不对产品界面开放。
- 抽取任务的原始粘贴文本在任务结束时立即清除；`modelCalls.outcome` 中的私密 rationale 随房间一起保留或一起清除。
- 保留期限（例如关闭 N 个月后自动清除）是开放问题（18 Q-07），取决于目标客户的合规要求。

## 7.12 对模型提供方的披露

每次代理回合会把**本角色**的私密简报、对本角色披露的他方字段、公开目录与候选发送给 Anthropic API；不会把其他角色的私密字段发出（I15）。产品的隐私说明与委托条款第 5 条如实写明这一点；是否需要零数据保留协议或企业条款由部署方决定（18 Q-08）。

# 13 前端信息架构（part2）：实时更新、加载与错误、可访问性、响应式、标注、诊断、语言

## 13.5 实时更新策略

| 页面 | 订阅 | 说明 |
| --- | --- | --- |
| 工作台 | `rooms.workspace`（一个聚合 query） | 三个窗口拿到同一时刻的一致快照；预算一提交，所有窗口在同一次推送中翻转为 Blocked（F13.1） |
| 我的简报 | `briefs.myDraft` | 本地编辑状态 + 防抖 800ms 自动保存（`saveDraft` 带 `revision`）；`STALE_DRAFT` 时提示 "This brief changed in another tab" 并提供 "Load latest" |
| 清单 | `lists.view` | 作者编辑走草稿；确认前调用 `previewConfirm` |
| 历史 | `history.timeline`（`usePaginatedQuery`）、`proposals.history` | 响应式分页的页大小会变化，由客户端处理（04 平台约束 1.9） |
| 记录 | `records.view`、`ledger.view` | — |

- **不做乐观更新**的操作：签核、拒绝、确认简报、确认清单、预算变更、回答请求——一律以服务端提交结果和订阅回推为准（04 平台约束 5.1）。按钮在 mutation 进行中显示 pending 并禁用，防止连点（服务端另有幂等）。
- 草稿编辑是唯一使用本地状态先行的地方（它本来就只属于本人）。
- 可选 SSR 预取：页面壳在服务端 `auth().getToken({template:"convex"})` + `preloadQuery`，客户端 `usePreloadedQuery` 接续；预取结果与普通 query 一样已投影。v1 默认纯客户端订阅，首屏骨架屏即可。
- 不把任何 query 结果写入 localStorage/sessionStorage（登出后不残留私密数据）；只记住 UI 偏好（展开/折叠、最后访问的页签）。

## 13.6 加载、空状态与错误

| 状态 | 判定 | 显示 |
| --- | --- | --- |
| 加载中 | `useQuery` 返回 `undefined` | 区块骨架屏；不闪烁空状态 |
| 无权或不存在 | 返回 `null` | "This room doesn't exist or you're not a member."（不区分两者） |
| 未登录 | `useConvexAuth().isAuthenticated === false` | 跳转登录（proxy 已处理大部分情况） |
| 依赖 Convex 的组件在 Provider 缺失时 | 半配置环境 | 不渲染这些组件，显示 "Backend not configured. See /admin/health."（F11.3） |
| mutation 错误 | `ConvexError.data.code` | 按下表映射为人话；未知码显示通用文案 + "Try again" |
| action 断线失败 | 客户端报错 | "Connection lost. Try again."（邀请接受、抽取） |
| 渲染异常 | `error.tsx` 边界 | 带重试按钮；不展示堆栈 |

错误码 → 文案（节选）：

| code | 文案 |
| --- | --- |
| `CONSTRAINTS_CHANGED` | "Constraints changed while you were working. Nothing was recorded — review the latest version." |
| `PROPOSAL_NOT_CURRENT` | "A newer proposal replaced this one." |
| `PROPOSAL_NOT_EXECUTABLE` | "This version can't be approved right now." + 检查清单中的失败项 |
| `STALE_DRAFT` | "Your brief changed in another tab." |
| `CAP_BELOW_COMMITTED` | （只有 finance 会遇到）"The cap can't be lower than committed spend ($4,000)." |
| `CANDIDATE_BLOCKED` | "That option doesn't meet the room's constraints:" + 按本人投影的原因 |
| `AGENTS_DISABLED` | "Agents are paused by the operator. You can still choose options yourself and approve." |
| `RATE_LIMITED` | "Too many requests. Try again in a few minutes." |
| `ALREADY_SEATED` | "You already hold another seat in this room." |

## 13.7 可访问性

- 语义化区块 `section` + `aria-labelledby`；页签与对比表当前行用 `aria-current`（吸收 Role A §7.6）。
- 状态徽章同时用颜色、图标与文字，不只靠颜色；对比度达到 WCAG AA。
- 所有动作结果写入 `aria-live="polite"` 区域（例如 "Recorded your acceptance of v2"）；阻断翻转用 `aria-live="assertive"` 一次性播报 "Proposal v1 is now blocked"。
- 禁用按钮旁必有可读原因，并以 `aria-describedby` 关联。
- 预算条 `role="img"`，`aria-label` 内容同样按角色投影（provider 只读到结论）。
- 全键盘可达：请求卡选项、候选浏览器、签核对话框；对话框焦点陷阱与 Esc 关闭。
- 宽表放在可横向滚动的容器内，并提供卡片视图。

## 13.8 响应式

- 工作台在 < 960px 改为单列，顺序：待办 → 请求卡 → 当前提案（含签核按钮）→ 代理进度 → 其余；审批与回答请求在手机上可完整完成（FX-09）。
- 简报编辑在手机上可用但以桌面为主；清单编辑器在窄屏改为逐项表单。
- 原生应用不在 v1（17）。

## 13.9 标注与诚实纪律

1. `isSimulated` 房间整页横幅 "Simulated room · seeded from fixture …"；报价行 "Simulated quote"；stub 代理提案与立场 "Simulated agent"。
2. 代理立场永远标 "advisory"；人提出的提案显示 "Proposed by Customer (Maya)"；代理提案显示 "by Provider's agent"。
3. 代理笔记区没有内容时显示 "No notes yet"，不生成占位消息（RA-U07）。
4. 检查清单标题是 "Checked against constraints v7"，不写 "Matches current constraints"（RA-B01）。
5. 变更单页固定声明 "Internal record only. No payment, transfer, or signature happens in Speak for Me."（核心 7）。
6. 成本显示一律带 "estimated"。

## 13.10 诊断页 `/admin/health`

- `useConvexAuth()` 显示是否已认证；`useQuery(api.health.viewer)`（未认证时 `"skip"`）显示 "Convex accepted the Clerk token" 或 "Check CLERK_JWT_ISSUER_DOMAIN"；显示从 publishable key 解码出的 Frontend API 主机名，便于发现"key 与 issuer 来自不同 Clerk 实例"（F13.4）。
- `health.config`（管理员）分别报告"已配置 / 可用"：Clerk issuer、Anthropic key、`AGENT_MODE`、`AGENTS_ENABLED`、模型核验时间（P-19）。从不显示任何密钥值。

## 13.11 语言

- v1 产品界面为英文（与原仓库约定一致）；所有用户可见句子来自引擎与场景模板，模板按 `locale` 组织（`en`），读时渲染，因此加入 `zh-CN` 只需补模板与界面字符串，不改数据（ADR-24）。
- 日期以 `YYYY-MM-DD` 显示日历日；事件时间按查看者浏览器时区显示，"今天"与截止判断按房间时区（RA-X03）。

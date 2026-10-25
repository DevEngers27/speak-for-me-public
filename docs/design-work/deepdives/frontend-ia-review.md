# 反驳评审：前端信息架构与视图模型（frontend-ia）

> 评审对象：deepdives/frontend-ia.md、-part2…part6.md、frontend-ia/{view-models,projection,copy}.ts。
> 对照：00-brief §3 核心、inputs/04、/Users/zhennn/cal-hack-2026-main/node_modules（convex 1.48.0、next 16.4.3、@clerk/nextjs 7.9.20、react 19.3.1）、兄弟专题 versioned-approvals、idempotent-execution、run-lifecycle、privacy-disclosure。
> 文件拆分：本文件（§1 总评、§2 待验证声明逐条核对）；frontend-ia-review-part2.md（§3 问题清单 r01–r08）；frontend-ia-review-part3.md（r09–r13、§4 建议的最小改动集）。

## 1. 总评

整体方向正确：页面壳 + 客户端订阅、一个聚合 `rooms.view` 承载所有依赖约束版本的判断、判别联合表达预算可见性、审批携带 `expectedConstraintsVersion`、不做乐观更新、旧审批保留可见、代理建议与审批分区，这些都直接落实了核心 1、2、3、6、8。

主要问题集中在四处：
1. **隐私防线有两个漏口**：`constraints.previewChange` 对他方私密约束构成可任意试探的 oracle；`projectCheckParams` 默认放行（注释写"丢弃"，代码 `return params`），而 `params` 是 `v.record`，returns validator 无法兜底（核心 1）。
2. **审批槽位派生与兄弟专题和自身时序矛盾**：`deriveSlotState` 取"任意提案上的最新决定"，新提案出现时会显示 `stale_approved` 而不是 `pending`，与 §3.6 步 7 和 versioned-approvals 的按提案汇总冲突（核心 3 的呈现）。
3. **命名与语义和 08/09/10 专题不一致**：`STALE_VIEW` vs `CONSTRAINTS_CHANGED`、`isExecutable` 含义不同（versioned-approvals 的定义含"审批已齐"，会让 `deriveTodos` 永远不产出 `decide_proposal`）、run 状态枚举完全不同。
4. **若干平台假设与真实源码不符**：Convex 客户端本来就对相同参数的 query 去重；断线最长 60 秒才被检测到；Clerk 未加载完时 query 以未认证身份执行会返回 null 并闪现 NotAvailable；Next 16.3 起 error 边界推荐 `retry()`，且 `error.tsx` 不包裹同段 `layout.tsx`。

过度设计方面不严重：`RoomViewProvider` 的去重理由不成立但组件本身可保留；`events.timeline` 的多维筛选与私密事件合并可以收缩。

## 2. 待验证声明逐条核对

| # | 作者声明 | 结论 | 证据 |
| --- | --- | --- | --- |
| C1 | 同一服务端时刻的多个 query 更新在一条 Transition 消息里一次应用 | **源码层面属实，正式保证仍待验证**。设计不依赖它是对的 | `convex/src/browser/sync/client.ts:467-471`：`case "Transition"` 内一次 `remoteQuerySet.transition` + `state.transition`；`convex/src/react/client.ts:797-810` 在同一个同步循环里调用所有受影响 query 的 listener，React 19 自动批处理。未找到文档化的"跨 query 一致"承诺 |
| C2 | returns validator 拒绝多余字段 | **本地无法核实，维持待验证**；且 convex-test 是否执行 returns 校验也待验证 | `convex/src/server/impl/registration_impl.ts:186-196` 的 `exportReturns` 只把 validator 序列化成 JSON 交给后端，校验发生在后端（不在 npm 包内）；`validateReturnValue`（:75-81）只检查"是否返回了 Query 对象"。因此 D-FE-03 的"运行时防线"必须用 dev 部署实验确认 |
| C3 | `useConvexConnectionState` 存在，字段含 `isWebSocketConnected`/`hasEverConnected`/`hasInflightRequests` | **属实**；另有 `inflightMutations`、`timeOfOldestInflightRequest`、`connectionRetries` 可用。**断线更新时机已查明**：静默断网最长约 60 秒后才被判定 | `dist/esm-types/react/index.d.ts:74` 导出；`dist/esm-types/browser/sync/client.d.ts:116-145` 字段；`src/react/client.ts:1196-1220` 实现；`src/browser/sync/web_socket_manager.ts:235-239`（`serverInactivityThreshold = 60000`，服务端每 15s Ping）、`:557-568`（超时才 closeAndReconnect）、`:279-284`（只监听 `online`，不监听 `offline`） |
| C4 | 默认 `useQuery` 出错抛给错误边界；`useQuery_experimental` 返回 pending/success/error 联合 | **属实** | `src/react/client.ts:951-953`（`if (result instanceof Error) throw result`）；`dist/esm-types/react/client.d.ts` 中 `UseQueryResult`（`throwOnError: true` 时无 error 分支） |
| C5 | 加载中 `undefined`，返回 `null` 可区分 | **属实** | `src/react/client.ts:927` 返回类型 `FunctionReturnType<Query> \| undefined`；`null` 是合法 Convex 值 |
| C6 | 多个相同参数的 `useQuery` 共享一个订阅 | **属实（已在源码确认）** → `RoomViewProvider` 的"规避"理由不成立 | `src/browser/sync/local_state.ts:88-110`：以 `serializePathAndArgs(udfPath,args)` 为 token，已存在则 `numSubscribers += 1`、不发新的 QuerySetModification |
| C7 | 重连时重发在途 mutation、在途 action 判失败 | **属实**；补充：断线期间新发起的 mutation 以 `NotSent` 入队，重连后发送 | `src/browser/sync/request_manager.ts:193-226`；`:199-202`（NotSent → Requested） |
| C8 | Server Component props 与 preloadQuery 结果进入 RSC payload | 按 04 §5.1（Next 文档引用）**接受** | inputs/04-platform-constraints-part7.md §5.1 |
| C9 | `auth.protect()` 乐观检查，未登录文档请求重定向 | **属实** | `@clerk/nextjs/dist/types/app-router/server/auth.d.ts`（7.9.20）protect 行为表：未认证文档请求重定向，非文档请求 404，已认证未授权 404 |
| C10 | `ConvexProviderWithClerk` 取 token 出错返回 null、错误被吞 | **属实** | `src/react-clerk/ConvexProviderWithClerk.tsx:73-90`（`catch { return null; }`） |
| C11 | query 里读 `Date.now()` 有缓存问题；到期由调度 mutation 关闭、倒计时在客户端 | **缓存影响属实；"冻结"细节待验证**；设计做法正确 | `src/server/meta.ts:173-174`："calling this in a query limits caching of the query's result the same way `Date.now()` does" |
| C12 | convex-test 用 `withIdentity`，不模拟并发 | **待验证**：convex-test 未安装在任一仓库；04 §1.12 也标待验证 | `ls node_modules` 无 convex-test |
| C13 | Clerk 支持 Playwright 多测试用户（@clerk/testing） | **待验证**：未安装；包名与 API 以 Clerk 文档为准 | `ls node_modules/@clerk` 仅 nextjs 等运行时包 |
| C14 | 生产部署隐藏非 ConvexError 消息 | **待验证**：npm 包内无对应逻辑（由后端决定），来源只是审查发现 F07.8 | `grep -rn "Server Error\|redact" convex/src/browser` 无结果 |
| C15 | 每角色一人且不同 userId、kind terms/budget、执行与最后一次审批同事务 | **已被兄弟专题采纳**；但 versioned-approvals 的决定集合还有 **`withdraw`**，前端未覆盖 | `versioned-approvals/schema.ts:11,20`；`idempotent-execution/schema-fragment.ts:12`；`idempotent-execution.md` D1；`versioned-approvals/standing.ts:75`（"首个场景每角色一人"） |
| C16 | Next 16 `error.tsx`/`global-error.tsx` 约定在 16.4 中没有变化 | **不完全成立**：文件约定仍在，但 16.2 加入 `unstable_retry`、**16.3 起 `retry` 稳定并被推荐优先于 `reset`**；且 `error.js` 不包裹同一段的 `layout.js` | `next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:96, 117-157, 327-332` |

补充核实（支持设计）：mutation 的 Promise 要等本地 query 集合推进到该 mutation 的提交时间戳之后才 resolve（`request_manager.ts:169-176` `removeCompleted(ts)`，由 `client.ts:472-474` 以 `remoteQuerySet.timestamp()` 调用）。所以 `await decide()` 返回时，订阅已经反映了这次写入，"不做乐观更新、以订阅回推为准"不会产生"按钮已回弹但面板未更新"的空窗。

# 07 权限与隐私（第 1/2 部分：认证、授权、矩阵）

## 7.1 认证 ≠ 授权

| 层 | 机制 | 能证明什么 |
| --- | --- | --- |
| 认证 | Clerk 会话 → Convex JWT（`auth.config.ts`，`applicationID: "convex"`，缺 `CLERK_JWT_ISSUER_DOMAIN` 时部署失败） | 调用者是 `tokenIdentifier` |
| 入口提示 | Next 16 `proxy.ts` 的 `auth.protect()` | 只做登录跳转，不是授权（inputs/04 §3） |
| 授权 | 每个公共 Convex 函数开头的 helper | 调用者在该房间的角色 |

```ts
// convex/lib/auth.ts
export async function getViewer(ctx): Promise<Doc<"users"> | null>;            // query：未登录返回 null
export async function requireViewer(ctx): Promise<Doc<"users">>;               // mutation：未登录抛 UNAUTHENTICATED
export async function requireMember(ctx, roomId): Promise<{ user; member; room }>; // 非成员抛 NOT_A_MEMBER（query 返回 null）
export async function requireRole(ctx, roomId, roleKey): Promise<{ user; member; room }>;
```

规则：业务函数从不接受 `userId` 或 `roleKey` 作为"我是谁"的参数；被调度的 internal 函数不依赖身份，调用方 mutation 先鉴权，再把 `actorUserId` 作为参数传入（inputs/04 §1.7）。

## 7.2 字段 × 角色披露矩阵（首个场景）

图例：● 可见原值；◐ 只见派生结论或 reasonCode；○ 不可见；★ 取决于该字段的 disclosure 决定（默认值见括号）。

| 字段 | customer | provider | finance | 说明 |
| --- | --- | --- | --- | --- |
| rooms.title / goal | ● | ● | ● | 公开 |
| customer.requiredItemKeys | ● | ★（默认披露） | ★（默认披露） | |
| customer.desiredItemKeys / deferrableItemKeys | ● | ★（默认不披露） | ★（默认不披露） | requestedItemKeys（三者并集）默认披露，用于计算 deferred |
| customer.hardDeadline | ● | ★（默认披露） | ★（默认披露） | |
| customer.preferredDate / tradeoffPreference | ● | ★（默认不披露） | ★（默认不披露） | |
| customer.notes | ● | ○ | ○ | 永不可披露 |
| catalog（title、price、lead days） | ● | ● | ● | 确认即视为 provider 对房间的报价披露 |
| provider.rushAvailable | ● | ● | ● | 由目录是否有 rushLeadDays 体现 |
| provider.notes（产能等） | ○ | ● | ○ | 永不可披露 |
| budgets.totalCents | ● | ○ | ● | 买方 / 卖方划分（ADR-08） |
| committedCents（派生） | ● | ○ | ● | |
| headroom / shortfall（派生） | ● | ○ | ● | |
| budgets.softHeadroomCents、finance.notes | ○ | ○ | ● | |
| budgetChanges（含 reason） | ○ | ○ | ● | |
| proposal.terms（条目、价格、日期、deferred） | ● | ● | ● | 提案本身是公开谈判内容 |
| proposal 校验结果 | ●（全部码 + 数字） | ◐（`EXCEEDS_FINANCE_LIMIT` 等，无数字） | ●（全部码 + 数字） | `projectReasonCodes` |
| proposal "approval 后已承诺总额" | ● | ○ | ● | provider 只见本次变更额 |
| turns.decision（动作 + 候选） | ● 本方 | ● 本方 | ● 本方 | 他方只经模板事件看到动作摘要 |
| turns.rationale / validation / flags | ● 本方 | ● 本方 | ● 本方 | 永不跨方 |
| modelCalls（token、延迟） | ● 本方 | ● 本方 | ● 本方 | 房间级汇总（无内容）对全员可见 |
| decisions | ● | ● | ● | 谁在何时批准 / 拒绝哪个版本是公开的；拒绝码公开 |
| humanRequests | ● 目标是本人 | ● 目标是本人 | ● 目标是本人 | 他方只见"等待 X 回答"事件 |
| changeOrders.terms | ● | ● | ● | |
| commitments | ● | ○ | ● | |
| tasks | ● | ●（本人为 assignee） | ● | |

provider 可以从"某组合被阻断、另一组合通过"推断余量区间。这是谈判结果本身的固有披露，不是预算数字泄露；界面与代理上下文对 provider 披露的信息完全一致，在威胁模型中登记为已接受风险（T7）。

## 7.3 动作 × 角色矩阵

| 动作（函数） | customer | provider | finance | owner 额外 | 系统 |
| --- | --- | --- | --- | --- | --- |
| `rooms.create` | ✓（允许名单） | ✓ | ✓ | — | — |
| `invites.create / revoke` | — | — | — | ✓ | — |
| `invites.accept` | 持码者 | 持码者 | 持码者 | — | — |
| `briefs.saveDraft / confirm`（本角色） | ✓ | ✓ | ✓ | — | — |
| `catalog.saveDraftItem / confirm / retire` | — | ✓ | — | — | seed |
| `budgets.update` | — | — | ✓ | — | seed |
| `runs.start / retryTurn` | ✓ | ✓ | ✓ | — | ✓（bump 后） |
| `runs.cancel` | — | — | — | ✓ | — |
| `decisions.submit`（terms） | ✓ | ✓ | — | — | ✗ |
| `decisions.submit`（budget） | — | — | ✓ | — | ✗ |
| `humanRequests.answer` | targetRole = 本角色 | 同左 | 同左 | — | ✗ |
| `tasks.updateStatus` | — | assignee | — | — | — |
| `rooms.close` | — | — | — | ✓ | — |
| 写 turns / proposals / changeOrders / events | ✗ | ✗ | ✗ | ✗ | ✓（internal） |

owner 身份不带来审批权或读他方私密的权利。一人不能占两个角色（I13），所以"三方批准"必然来自三个不同 userId。

## 7.4 成员与角色授予
1. `rooms.create`：创建者选择自己的角色（首个场景默认 customer），同事务插入 member、空预算（totalCents 0，finance 之后设置）。
2. `invites.create(roomId, roleKey)`：生成 32 字节随机码，只存 `sha256(code)`，明文只在返回值中给 owner 一次；7 天过期。
3. `invites.accept(code)`：按 codeHash 查邀请 → 守卫（04 §4.7）→ 插入 member（displayName 取 `identity.name`，缺失则要求用户先在个人页填写；Clerk JWT 是否带 name 待验证）。
4. 知道 roomId 不能加入房间；房间 URL 泄露只暴露"房间存在"（query 对非成员返回 null）。

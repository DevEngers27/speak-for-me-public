import { w2BatteryCases } from '../../convex-helpers/w2Battery.fixture';
import {describe,it as vitestIt} from 'vitest';
import {runtimeCase} from '../../convex-helpers/runtimeCases.w2-4.fixture';
import {batteryChecks} from '../../convex-helpers/workflows.fixture';
import {cases,previewMatrix,privacyEquivalentChanges,providerSnapshotIndependentOfCap} from '../w2-3.cases';



const implemented: Record<string, () => Promise<void>> = {
  'INV-12': runtimeCase('INV-12'),
  'CE-008': runtimeCase('CE-008'),
  'CE-171': runtimeCase('CE-171'),
  'CE-007': runtimeCase('CE-007'),
  'CE-009': runtimeCase('CE-009'),
  'CE-033': runtimeCase('CE-033'),
  'INV-13': batteryChecks['INV-13']!,
  'INV-15': batteryChecks['INV-15']!,
  'INV-16': batteryChecks['INV-16']!,
  'INV-17': batteryChecks['INV-17']!,
  'INV-18': batteryChecks['INV-18']!,
  'CE-001': batteryChecks['CE-001']!,
  'CE-014': batteryChecks['CE-014']!,
  'CE-021': batteryChecks['CE-021']!,
  'CE-022': batteryChecks['CE-022']!,
  'CE-029': batteryChecks['CE-029']!,
  'CE-034': batteryChecks['CE-034']!,
  'CE-173': batteryChecks['CE-173']!,
  'CE-174': batteryChecks['CE-174']!,
  'CE-175': batteryChecks['CE-175']!,
  'CE-005': providerSnapshotIndependentOfCap,
  'CE-011': cases.priceBucket,
  'CE-012': cases.hardBucket,
  'CE-013': previewMatrix,
  'CE-016': cases.belowCommitted,
  'CE-017': cases.belowCommitted,
  'CE-015': privacyEquivalentChanges,
  'CE-003': w2BatteryCases['CE-003']!,
  'CE-031': w2BatteryCases['CE-031']!,
  'CE-032': w2BatteryCases['CE-032']!
};
const it = {todo(title:string){const run=implemented[title.split(" ")[0]!];if(run)vitestIt(title,run);else vitestIt.todo(title);}};
describe("CT · 01-privacy-delegation", () => {
  it.todo("INV-01 ∀ 公开 query 的返回 DTO、∀ 事件渲染参数、∀ 代理上下文，都等于 `projectForRole(viewerRole, …)` 的输出；对 `viewerRole ≠ brief.role` 的查看者，DTO 中不存在 `briefs.hardFields` / `softFields` 里未经 `sharedFacts` 向其披露的键（取该 `(fromRole, field)` 的最新行，`value !== null` 且查看者 ∈ `audience`；历史值按 `briefVersion ≤ 值所属版本` 的最新行判定，07 §7.8.3）；他方投影从不读 `briefs` 行");
  it.todo("INV-11 provider 对任何提案（含历史）只见 `fit ∈ {ok, blocked}`；所有角色的历史提案只显示存储状态（`superseded / rejected / stale / executed`），`fit` / 检查清单只对当前提案计算（同时关闭\"事后打开披露回看旧提案\"的溯及通道）；`rooms.previewChange`：只有 finance 改上限得 `verdictAfter`（只含当前提案的预算检查，不做可行性枚举），finance 新上限低于已承诺得 `{ verdict: 'rejected' }`，查看者自己的其他变更得 `{ verdict: 'recheck', nextConstraintsVersion, invalidatedApprovals, willSupersedeRun }`，硬投影不变得 `unchanged`，变更种类不属于查看者 → `null`（形状以 12 §12.17 为唯一定义）；**任何角色**的 `clarify` 话题表都不含 `option_fits_constraints`，可代答 clarify 每角色每 run ≤ 1；每 run 每角色 `propose / counter` ≤ 4；节流桶（D12 ⑥、12 B7）：`constraint_writes`——`briefs.confirm` / `catalog.confirm`（一批计一次）/ `catalog.retire` / `budget.setCap` / `runs.start`（已有非终态 run 时幂等返回、不计）/ `runs.requestRenegotiation` / `runs.retryTurn` / `humanRequests.answer` 每用户每房间滚动每小时 ≤ 6；`price_writes`——房间 `open` 期间每 24 小时 ≤ 3 批改价 / 改工期 / 新增 / 撤下，每个 open run 内同一 itemKey 改价 ≤ 1 次，`setCap` 与 customer 硬字段变更共用每房间每 24 小时 ≤ 6 子桶；`run_starts`——每房间每 24 小时 ≤ 6 个 run；超限 `run.rate_limited { retryAfterMs }`；被拒与 `unchanged` 不计数");
  it.todo("INV-12 `events.payload` 只含房间可见的结构化字段（validator 白名单：id、枚举、版本号、公开金额），无自由文本、无私密数值；`events` 无 `visibility` 字段；需要私密细节的事件带 `restrictedRef` 指向本就按角色控制的行；`run_needs_input` / `human_request_opened` 对 provider 渲染为 `run_waiting`（无 kind、无 toRole）；`constraints_changed` 有 finance / customer / provider 三种渲染");
  it.todo("INV-13 浏览器只收 `ConvexError({ code, params })`，`params` 经与 DTO 相同的受众投影；公开 query / mutation 内无 `console.*`；非 `ConvexError` → `opsLog('unhandled', { errorClass })` + `ConvexError({ code: 'internal' })`；模型原文只存 `attempts.rawOutputRef`（无公开 query）；SDK 错误映射为码后丢弃原消息；解析失败只记 issue 路径（未知段替换为 `*`）");
  it.todo("INV-15 `members` 上 `(roomId, userId)` 与 `(roomId, role)` 逻辑唯一；`members.role` 不可变；v1 不换人、不解绑");
  it.todo("INV-16 角色只能由 `invites.role` 授予（creator 指定）；邮箱定向邀请要求 `identity.emailVerified === true ∧ email === invitedEmail`；链接邀请只存 `tokenHash`、token 在 URL fragment、72h、一次性；creator 无额外审批权");
  it.todo("INV-17 公开函数不接受\"我是谁\"类参数（userId / role / memberId）；身份只来自 `ctx.auth.getUserIdentity().tokenIdentifier → users`；被调度的 internal 函数必须显式 `actorUserId`，鉴权在调度前完成；动作 × 角色矩阵在服务端");
  it.todo("INV-18 `sharedFacts` 的值只能是日期 / `itemKey[]` / 枚举 / 整数分，且**只从调用者本人当前已确认简报复制**（`sharedFacts.add` 没有 value 参数，结构上无法转述他方的值）；字段不在调用者角色的 `SHAREABLE_FIELDS` 或受众超出允许集 → `disclosure.blocked`；本人硬字段对他方披露未带 `confirmOwnDisclosure: true` → `disclosure.needs_own_confirmation`；日期窗口（`localDate ≤ d ≤ localDate + 365`）在写入简报时校验（`date.out_of_range`），customer `requiredItemKeys` 必须是本房间曾确认过的目录键（`item.unknown`）；闸门不把值与他方秘密比对（比对结果本身是预言机）");
  it.todo("CE-001 provider 身份调用 `briefs.mine` / `rooms.view` / 任意 memberQuery，期望读到 finance 简报");
  it.todo("CE-003 customer 确认简报时不披露 `requiredItemKeys` 与 `softFields`；provider 代理提含 `usage_dashboard` 的候选；检查提案 DTO、`proposal_created` 事件、公共模板、`termsKey`、`changeOrders` 是否出现任何\"未纳入 / 延后\"集合");
  it.todo("CE-005 finance `budget.setCap(480000)`（cv+1）；对比 bump 前后 provider 回合的 `candidateSnapshot`");
  it.todo("CE-007 customer 未向 finance 披露 required；无解 → 给 finance 的 `raise_cap` 请求");
  it.todo("CE-008 finance 不披露预算；无解 → 给 customer 的 `drop_items` 选项；随后只改 cap 再生成一次");
  it.todo("CE-009 provider 代理在同一 run 连续 `propose` O1…O5 二分预算");
  it.todo("CE-011 provider 在 open 房间里每隔一分钟 `catalog.confirm` 改 `sso_login` 价格，观察新 run 是 \"agents working\" 还是 `run_waiting`（零成本预言机）");
  it.todo("CE-012 customer 反复 `briefs.confirm` 改 `requiredItemKeys`（每次 bump 后系统自动开新 run）观察是否 needs_input");
  it.todo("CE-013 customer 调 `rooms.previewChange({ change: { kind: 'cap', … } })` 期望得到 `verdictAfter`；customer 预览自己的 `customer_hard` 变更；finance 预览改上限");
  it.todo("CE-014 provider 保存目录 `draft` 价格 X 后调任何 query 期望看到\"确认后是否可行\"（草稿预言机）");
  it.todo("CE-015 finance 降预算；读 `timeline.page` 分别以三身份渲染 `constraints_changed`");
  it.todo("CE-016 finance 把 cap 降到 390000（< committed 400000）；以 provider 读时间线与 `rooms.view`");
  it.todo("CE-017 触发 `budget.below_committed`；检查 `ConvexError.data` 对 finance 含 `minAllowedCapCents`、对其他身份调用同函数无数值；服务端日志只有 code");
  it.todo("CE-021 用 customer 邀请 token 接受后，再用同一 token 以另一账号接受 finance 席");
  it.todo("CE-022 邮箱定向邀请（`invitedEmail = a@x`）被 `b@y` 已登录用户接受；或 `emailVerified = false`");
  it.todo("CE-029 customer `sharedFacts.add({ field: 'capCents', audience: ['provider'] })`；customer 调 `sharedFacts.add` 夹带 `value: 480000`；customer `briefs.confirm` 写 `deadline: '4800-01-01'`；customer 把自己的 `deadline` 披露给 provider 但未带 `confirmOwnDisclosure`");
  it.todo("CE-031 provider 拒绝时填写 `note`、选 `reasonKey`；检查事件 payload、customer / finance 的 DTO 与代理上下文");
  it.todo("CE-032 cv1 时 finance 未披露 headroom；cv2 后打开披露；customer 查看 v1 在历史中的检查结果与旧事件里的数值");
  it.todo("CE-033 run 进入 `needs_input(infeasible, toRole: finance)`；provider 读 `timeline.page` 与 `rooms.view`");
  it.todo("CE-034 finance 读 customer 的 `deadline`（customer 只向 provider 披露）");
  it.todo("CE-171 finance 把 `headroomCents` 共享给 customer；customer 代理的 counter 由含预算的视图枚举，通过全量检查的 counter 被转发进 provider 快照（counter 不是提案，不进提案列表）");
  it.todo("CE-173 简报或共享事实写入形如 `CAP_480000` 的伪 itemKey");
  it.todo("CE-174 `sharedFacts.add` 夹带自由 `value`");
  it.todo("CE-175 `disclosure_changed` 对非受众渲染出字段名或值；或与 cv + 1 同一提交单独渲染 \"Finance updated what they share\"，从而暴露约束变更者");
});

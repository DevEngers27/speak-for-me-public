# 03 Role A 分支决定（part1）

> 输入整理阶段产出，供所有设计代理使用。只做"吸收与评估"，不做最终设计；设计决定以 00-brief.md 为准。
> 来源：本机 Role A 分支 /Users/zhennn/Documents/26Fall/cal-hack-2026（只读，分支 feature/role-a-frontend）。代码不会被复用，想法逐条评估后吸收。

## 分片清单

本文按单文件 12,000 字节上限拆成 12 个分片。章节编号（§）全文统一，交叉引用一律用 § 编号和条目 id（RA-D / RA-R / RA-S / RA-U / RA-F / RA-T / RA-X / RA-B / Q）。

| 文件 | 内容 |
| --- | --- |
| 03-role-a-branch-decisions-part1.md | 分片清单、§0 读法、§1 分支概况与改动范围、设计者须知十条 |
| 03-role-a-branch-decisions-part2.md | §2 结论总表：全部条目的裁决一览 |
| 03-role-a-branch-decisions-part3.md | §3.1–3.6 数据形状：goal、预算字段、版本计数、RoomStatus、Member、BriefItem |
| 03-role-a-branch-decisions-part4.md | §3.7–3.9 ProviderOption、PrivateBrief 生命周期、角色；§4.1–4.3 Proposal、origin、deferredScope |
| 03-role-a-branch-decisions-part5.md | §4.4–4.8 Approval / Rejection、Commitment 与变更单、Task、RoomEvent、WorkspaceState（"same shapes"） |
| 03-role-a-branch-decisions-part6.md | §5.1–5.7 确定性规则：预算不变式、checkProposal 四项检查、校验来源、双版本审批、必需审批人、最后一票即执行、operationId |
| 03-role-a-branch-decisions-part7.md | §6.1–6.6 改上限、revalidated（否决）、bestFeasibleOption、无可行解与取舍请求、describeChange、简报校验与撤回 |
| 03-role-a-branch-decisions-part8.md | §6.7–6.8 状态迁移与事件清单；§7.1–7.3 全局框架、房间列表、私密简报页 |
| 03-role-a-branch-decisions-part9.md | §7.4–7.6 工作台、结果与历史、可访问性；§8.1 fixture 结构与数字 |
| 03-role-a-branch-decisions-part10.md | §8.2–8.3 公共文本生成方式、格式化与解析 |
| 03-role-a-branch-decisions-part11.md | §9 缺陷总清单（RA-B01–B31，含审查来源与本次新发现） |
| 03-role-a-branch-decisions-part12.md | §10 对最终设计各章的要求、回归测试清单、开放问题 Q1–Q13 |

同目录下的 03-role-a-branch-decisions.md 只是指向本分片集的索引。

## §0 读法

- **裁决含义**：
  - **采纳**：想法与形状基本照收；
  - **修改后采纳**：想法保留，形状或规则要改；
  - **否决**：不进入新设计，理由写明。
  任务书第 2 节规定不复用旧代码，所以"采纳"指吸收想法，不指复制代码。
- **引用格式**：`文件:行`，路径相对分支的 `src/`。§9 的表格中 `lib/workspace` 简写为 `lw/`，`components/workspace` 简写为 `cw/`。"README diff:N" 指分支工作区 README.md 的第 N 行（新增章节 "Local preview (Role A frontend)" 在第 100–114 行）。"原 README:N" 指 /Users/zhennn/cal-hack-2026-main/README.md。
- **审查 id**：gap1-07、architecture-01 等来自 41 代理审查的 findings.json。标"新发现"的是本次通读代码时发现、审查没有覆盖的问题。
- **核心编号**：指 00-brief.md 第 3 节的八条不可动摇的核心（1 私密委托、2 代理只建议、3 人批准具体版本、4 代码负责校验、5 执行幂等且原子、6 历史不可篡改、7 执行边界、8 不伪造）。
- **"新设计要求"**：只是给 02–16 号设计文档的输入和建议形状，字段名与最终 schema 以设计文档为准。平台行为（Convex 事务、OCC 重试等）以 inputs/04 为准，本文未验证的都标了"以 inputs/04 为准"。

## §1 分支概况与改动范围

- **仓库状态**（只用了 `git status --short`、`git diff --stat`、`git diff`、`git show`）：
  - 分支 feature/role-a-frontend 只有一个根提交 b15184e，是原 main 的快照；
  - 全部工作都没有提交：6 个已跟踪文件 +113 / −7 行，另有 3 个未跟踪目录共 14 个文件 1,362 行；
  - 分支基于旧版 README（`git show HEAD:README.md` 共 409 行，原仓库现行 README 为 601 行）。

| 文件 | 行数 | 作用 |
| --- | --- | --- |
| lib/workspace/types.ts | 105 | 视图模型：Room、Member、BriefItem、ProviderOption、PrivateBrief、Proposal、Approval、Rejection、Commitment、Task、RoomEvent、WorkspaceState、标签 |
| lib/workspace/rules.ts | 94 | 确定性规则：checkProposal、approvalStates、allApproved、bestFeasibleOption、operationId、describeChange |
| lib/workspace/preview-store.ts | 367 | localStorage 预览存储与全部动作：createRoom、saveBrief、proposeFromOptions、approve、reject、changeBudgetCap、resendExecution、toggleTask、reset，以及内部 execute |
| lib/workspace/fixture.ts | 92 | 演示种子数据 |
| lib/workspace/format.ts | 20 | 金额、日期、时间格式化与金额解析 |
| components/workspace/*.tsx | 666 | workbench 226、brief-page 124、results-page 122、room-list 96、room-frame 81、role-switcher 17 |
| app/rooms/[roomId]/**/page.tsx | 18 | 三个路由壳：工作台、简报、结果 |
| 已跟踪文件改动 | +113 / −7 | README 新增 Local preview 章节；globals.css +86 行样式；layout 加角色切换与页脚；首页、房间页文案；negotiation.ts 导出 `AgentRole` 类型 |

- **运行模型**：
  - 整个 WorkspaceState 存在一个 localStorage 键 `speak-for-me:preview:v1` 里（schemaVersion 1）；
  - 同一浏览器的多个标签页通过 `storage` 事件互相刷新，代替 Convex 实时订阅；
  - 每个标签页在 sessionStorage `speak-for-me:preview-role` 中记住"Preview as"选的角色；
  - 每个动作都经过 `mutate()`：重读、克隆、修改，成功才保存，返回 `{ok, message}`。
  - 没有后端、没有代理、没有认证。作者在 lib/workspace/preview-store.ts:10-13 和 README diff:104 自己写明：它不是后端，不能保护简报隐私，"proves nothing about privacy (G1)"。
- **它的价值**：第一次把原 README 的抽象规则落成了具体字段、具体检查和一条可以点完的流程：建房 → 三方确认简报 → 提案 → 批准 → 降预算阻断 → 取舍 → 新版本 → 执行 → 幂等重试。README diff:112 列出的 "Schema proposals" 是 rooms.goal、结构化 provider options、proposals.deferredScope、proposals.origin、rejections；实际还隐含改了 privateBriefs 的结构，没有列出（RA-B27）。

## 设计者须知十条

1. **最值得吸收的三个想法**：
   - 报价是用户确认的结构化记录（RA-D07）；
   - 提案带来源标注，界面不伪造代理消息（RA-D09、RA-U07）；
   - 审批同时绑定提案版本与约束版本，旧审批显示为 stale，但不删除、不计数（RA-R04）。
2. **预算规则对，归属错**：不变式 committed + cost ≤ cap 与"上限不得低于已承诺"是正确的硬规则（RA-R01、RA-R10）；但预算放在 room 上全员可见，四类房间事件还把金额写进公开文本，违反原 README 中"finance 私密输入"的设定（RA-B08）。
3. **"Matches current constraints" 只比较版本号**：必需范围、截止日、来源都不检查。按演示脚本可以执行一个违反客户硬约束的方案，审查已复现（RA-B01）。
4. **约束版本递增点不全**：只有改上限会递增；saveBrief 修改硬约束或报价都不递增，旧审批继续有效（RA-B02）。
5. **没有来源核对**：提案的价格、范围、日期从不与已确认报价比对；报价在提案之后被改价，旧提案照样能执行（RA-B04，新发现）。
6. **历史会丢**：简报原地覆盖，sourceRefs 是不可解析的人类可读字符串（RA-B05，新发现）；approve 还会删除自己的旧拒绝（RA-B06，新发现）。
7. **"same shapes" 迁移说明必须否决**：照做就是把全员私密数据发到浏览器（RA-D16、RA-B03）。读模型必须按查看者裁剪。
8. **revalidated 复制版本必须否决**：审批已经绑定约束版本，复制只是冗余绑定，还把 finance 的动作记成 provider 的提案（RA-R11）。
9. **bestFeasibleOption 只能当预检**：它是"范围条目最多、再最便宜"的固定规则，不是协商。新设计把它降级为确定性可行性预检：无可行解时，直接生成指向具体人的结构化取舍请求，不调模型（RA-R12、RA-R13）。另外，按 fixture 数字，降到 $4,800 后没有可行的已确认报价，而且 ≤ $800 的方案仍须覆盖必需的 1、2 项（§8.1）。
10. **页面信息架构可以吸收**：四页面（房间列表 / 我的私密简报 / 工作台 / 结果与历史），以及待办置顶、版本对比表、检查清单、审批面板、变更单卡、私密事件徽章、禁用按钮旁的原因说明都值得保留。"Preview as"、预览横幅、重发执行按钮、"Check confirmed options"、demo 文案是黑客松产物，予以否决（§7）。

# 01 产品

## 1. 用户与角色

| 角色 | 英文 | 在首个场景中是谁 | 私密输入 | 签字类型 |
| --- | --- | --- | --- | --- |
| 客户 | `customer` | 采购方的业务负责人 | 必需条目、想要条目（软）、首选日期（软）、硬截止日 | `terms` |
| 服务提供方 | `provider` | 外部软件服务商 | 报价目录（确认后对房间公开）、私密备注（软偏好） | `terms` |
| 财务 | `finance` | 采购方的预算负责人 | 预算上限、期初承诺、私密备注（软偏好） | `budget` |
| 房主 | owner（不是角色） | 创建房间的人，通常是 customer | — | 无，房主身份不带审批权 |

- 每个角色一个席位、一个人；一个人在一个房间只能占一个角色（03 members 唯一性）。
- customer 与 finance 同属采购方（buyer side），可以看到预算数字；provider 永远看不到（07）。

## 2. 首个场景：软件服务范围变更

一个已签约项目（期初承诺 $4,000，预算上限 $5,000）要追加范围。provider 有已确认报价：LOGIN $450、REPORTS $350、EXPORT $500、加急费 RUSH $100。customer 必须要 LOGIN，想要 REPORTS，EXPORT 可延后；首选 2026-11-09 交付（软），硬截止 2026-11-16。代理协商出 LOGIN + REPORTS 加急 $900；三方签字后系统写入变更单、+$900 承诺（已承诺变 $4,900）和两条任务。若 finance 在签字前把上限降到 $4,800，旧方案立刻在所有窗口变为不可执行，旧签字失效，系统重新协商出 LOGIN + REPORTS 标准交付 $800（恰好等于余量）。完整走查见 14。

## 3. 系统做什么 / 不做什么

| 做 | 不做 |
| --- | --- |
| 私密简报的草稿与逐项披露、确认版本只追加 | 不保存用户粘贴的原始文本 |
| provider 维护带修订历史的报价目录 | 模型不创建报价条目、不报价 |
| 代码枚举候选、代理挑选并表态 | 代理不能批准、不能改约束 |
| 规则闸门判定预算、必需条目、日期、报价来源 | 不信任模型的任何数字 |
| 人对具体版本签字，签字到齐即原子执行 | 不转账、不签法律合同、不写外部 ERP |
| 预算台账、承诺台账、对账视图（finance） | 不做会计总账、不做多币种、不做冲销（v1） |
| 约束变化自动使旧签字失效并重新协商或请求取舍 | 不做"代理替人回答取舍" |
| 用量与成本按回合记录 | 不在仓库里硬编码价格做账单 |

## 4. 关键用户旅程

### J1 建房与邀请
1. customer 创建房间（标题、目标、时区）→ 成为 owner 并以 customer 角色加入。
2. owner 为 provider、finance 各生成一次性邀请链接（明文只返回一次）。
3. 对方登录 Clerk 后打开链接 → `invites.accept` → 成为成员。

### J2 准备约束（房间 status = setup）
1. finance：设定预算上限（revision 1）→ 录入期初承诺（一次）→ 确认 finance 简报。
2. provider：录入报价条目并确认（每条一个修订）→ 确认 provider 简报。
3. customer：填写必需/想要条目、首选日期、截止日，逐项勾选"对房间可见"→ 确认。
4. 三份简报都确认、预算已设、目录非空 → 任一成员点 "Start negotiation" → 房间 active，run #1 开始。

### J3 协商与签字
1. 界面按回合显示 "Provider agent choosing an option…"，不做 token 流式。
2. 提案出现：所有人看到条目、变更金额、交付日期、"Checked against constraints v9"；买方额外看到 "+$900 change / $4,900 committed after approval / $5,000 limit / $100 headroom after"。
3. 每个人点 "Accept terms v3"（customer、provider）或 "Approve budget commitment v3"（finance）；代理的建议显示为 "Agent recommends — this is not an approval"。
4. 最后一个签字的点击直接返回 "Executed: CO-1"，结果页出现变更单、承诺、任务。

### J4 约束变化
1. finance 在签字过程中把上限改为 $4,800（必须填原因）。
2. 所有窗口同一刻：提案 v3 显示 "Blocked"，已有签字显示 "Stale (constraints v8)"。
3. 系统重新协商（新 run）；若无可行方案，向具体的人发出取舍请求（例如给 finance："Raise limit to at least $4,450?"）。

### J5 finance 对账
finance 打开 "Ledger"：上限修订、承诺分录（每条链接到变更单 → 提案 v3 → 三个签字）、实时余量、对账检查（全部通过显示 "Reconciled at constraints v9"）。

## 5. 成功标准（可验收）

1. provider 会话的任何查询返回与 WebSocket 负载中不出现预算上限、已承诺、余量数值。
2. 同一提案被并发点击 approve 10 次，commitments 只多 1 行。
3. 降预算后旧签字不再计入，执行被拒，直到在新约束版本下重新签字。
4. 模型返回任意 JSON（含编造金额）都不能改变任何金额。
5. `budget.reconcile` 在任何时刻返回零发现。

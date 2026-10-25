# 01 产品

## 1. 用户与角色（首个场景）
| 角色 | 是谁 | 想要 | 私密的 |
| --- | --- | --- | --- |
| customer | 客户方项目负责人 | 必需功能按时交付，尽量多拿想要的 | 偏好理由、真实灵活度（notes） |
| provider | 外包工作室负责人 | 卖出更多、可交付的范围 | 利润偏好（notes） |
| finance | 客户方预算负责人 | 不超预算、承诺可追溯 | 预算上限与已承诺（只对同侧 customer 披露） |

组织形态假设（hypothesis）：中型客户 + 外包工作室，客户内部有独立预算负责人；服务商愿意进入客户工作区的理由（更快拿到签核）待用户访谈验证。小公司里 finance 与 customer 可能是同一人——v1 不支持一人两角，此时该产品不适用（如实说明）。

## 2. 系统做什么 / 不做什么
| 做 | 不做 |
| --- | --- |
| 收集结构化私密简报与已确认报价目录 | 让模型发明报价、范围或日期 |
| 代码枚举可行方案，三个隔离代理各自替本方取舍、解释 | 一次调用让模型看到多方简报 |
| 人对具体版本审批，最后一票原子执行 | 把代理的"建议接受"当批准 |
| 约束变化即时阻断旧方案并重谈或向具体的人提问 | 转账、签署合同、修改外部 ERP、发外部通知 |
| 产出内部变更单、预算承诺、任务 | 在数据不足时编造一致意见 |

## 3. 关键用户旅程
1. **建房与入座**：创建者选场景 → 三个一次性邀请 → 各自登录接受。
2. **简报**：各自填写结构化简报，逐项决定披露；provider 确认报价目录（提示"确认后全员可见"）。
3. **协商**：任一方点 "Start negotiation"；看到各代理进度；provider 代理选一个候选，customer 与 finance 代理并行评估。
4. **审批**：三人各看到同一 v{seq}、检查结果、将写入的记录预览，按 kind 审批；代理推荐只作参考。
5. **转折**：finance 在审批中途下调预算（带原因）→ 所有窗口同一刻显示 v1 Blocked、旧审批 stale → 自动重谈出 v2 → 重新审批 → 执行。
6. **取舍**：无可行方案或代理僵持时，指定的人收到带选项的请求（例："Keep REPORTS, deliver 2026-11-20 (+$750)" / "Deliver 2026-11-13, defer REPORTS (+$600)"）。
7. **结果**：变更单、任务、审批记录、预算影响（按角色裁剪）可打印。

## 4. 成功标准（参数化，不绑定固定数字）
For any stored cap, a proposal is executable only if committed + impact <= cap and all plugin checks pass; lowering the cap below the projected total blocks the current plan in the same commit and starts renegotiation or a human request. 任何经 UI 输入的预算、报价、截止日在一次订阅回推内得到正确的 executable / blocked / needs_input 判定。

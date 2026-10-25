# 技术子决策：数据与演进 · part4（§5 否决理由、§6 风险与退出）

> 分片清单见 data-evolution.md 顶部。

## 5. 否决理由

| 候选 | 否决理由 |
| --- | --- |
| M2 自写批处理 | 要自己实现游标持久化、失败续跑、防重复 worker、状态查询、dry run，正是组件已有的；保留为组件失效时的退路 |
| M3 离线迁移 | 停写期间审批与执行不可用；失败会卡住部署，回滚困难（stack.convex.dev/intro-to-migrations） |
| M4 关闭 `schemaValidation` | 失去平台对形状的兜底，违背"代码负责校验"的纵深防御；脏数据进库后难以清理 |
| M5 只 upcast 不回填 | 新索引字段必须有值才可查询；读取端分支永久累积。只追加表上作为首选，普通表上不采用 |
| S2 `import --replace-all` 重置 | 删表级别的破坏，误指向 prod 即全毁；违背 #6；仅允许在一次性 dev 部署上手工使用 |
| S3 阶段快照 | 预置"已协商"状态等于伪造历史（#8）；`DD:testing-ops-part5.md:54` 已定 v1 不做 |
| E2 流式导出 | 把私密简报复制到第三方，扩大攻击面；没有 v1 需求；计划要求待验证 |
| P2 硬删除 | 破坏提案、审批、执行的可追溯性（#6） |
| P3 crypto-shredding | mutation 不能调外部 KMS，需 action 解密，读取路径变复杂；v1 数据量与合规需求不匹配；列为后续选项 |
| I2 标题 slug | 标题含机密语境（如"Q4 预算削减"），slug 进 URL、历史、Referer、日志；改标题导致链接失效或需要 slug 历史表 |
| I3 ULID/nanoid 公开 ID | 增加依赖与第二套唯一性检查（索引无唯一约束），只换来美观 |
| $2 dinero.js | v1 只需加、比、求和；每个 Convex 边界都要 `toSnapshot` / 反序列化；新增学习成本。触发重评条件：多币种、分配、百分比费用 |
| $3 `v.int64()` | bigint 不能直接 `JSON.stringify`，props、日志、测试快照都要特殊处理；安全整数范围已足够；与 F03.13 一致 |
| D2 Temporal polyfill 运行时 | 只为 4 个函数引入约 1 MB（unpacked）依赖，同时打进 Convex 与浏览器包；原生普及后又要移除 |
| D3 date-fns / D4 dayjs | 以 `Date`（时刻）为核心，日历日运算存在本地时区 off-by-one 风险；违反引擎"不用 `Date`"规则；能力远超需要 |
| D5 epoch 毫秒存截止日 | "截止日当天结束"要在每个比较点做时区换算；`DD:rules-engine.md:96` 已否决 |
| T2 只靠 1 MiB | 允许极长文本进入代理上下文、事件流和他方可见渲染，放大成本与注入面 |

## 6. 风险与退出策略

| 风险 | 可能性 / 影响 | 缓解 | 退出 |
| --- | --- | --- | --- |
| `@convex-dev/migrations` 仍是 0.x，API 变动或停止维护 | 中 / 低 | 锁定精确版本；`migrateOne` 写成独立纯函数并单测 | 换成 M2 自写外壳，迁移函数不动 |
| 组件把 `convex-helpers` 带进依赖，团队顺手用其 Zod 转换，违背 F03.13 | 中 / 低 | ESLint `no-restricted-imports` 禁止 `convex-helpers/server/zod*` | — |
| 迁移误改只追加表的哈希字段 | 低 / 高（审批绑定失真） | 代码评审清单 + 测试：迁移前后对每条提案重算 `contentHash` 必须不变 | 从发布前手动备份恢复（破坏性，先再备份一次） |
| Convex 默认运行时 `Intl` 不支持 `timeZone` | 中 / 中（夏令时边界日错一天） | 部署探针（part5 §7 V-D2）；退回 `fallbackUtcOffsetMinutes` 并在 UI 标注 | 把 `todayInTimeZone` 移到 `"use node"` action 预先计算并作为参数传入；或 polyfill 时区数据 |
| 自写 `isoDate.ts` 有算法错误 | 低 / 中 | 以 `temporal-polyfill` 为 oracle 的属性测试 + 闰年、月末、跨年固定用例 | 内部换成 `Temporal.PlainDate`，存储格式不变 |
| 抹除后从备份恢复导致 PII 复活 | 低 / 中 | 抹除清单保存在恢复范围外；恢复运行手册强制重跑 `reapplyRedactions` | 引入 P3 crypto-shredding |
| 运维导出的 ZIP 外泄（含全部私密简报） | 低 / 高 | 只允许运维、加密存储、30 天删除、`opsLog` 记账 | — |
| `MAX_AMOUNT_CENTS = $1M` 对真实客户过低 | 中 / 低 | 常量集中定义；提升上限只改常量（存量不受影响） | 若超过 2^53 分（不可能于此场景），改 `v.int64()` 走扩展-回填-收缩 |
| 文本上限过严影响真实使用 | 中 / 低 | 上限集中在一张表，放宽不需迁移；收紧需先检查存量 | — |

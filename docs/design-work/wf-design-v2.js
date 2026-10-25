export const meta = {
  name: 'speak-for-me-design-v2',
  description: 'Integrate all parallel outputs (9 candidates, deep dives, spikes, research, UI critiques, tech ADRs, Fable drafts) into the final design v2: proper canon, per-chapter rewrites, invariant battery, consistency verification, fixes',
  phases: [
    { title: '统一口径', detail: 'Fable 不限时重写 00-canon（命名、关键决定、冲突裁决、各章底稿与素材清单）' },
    { title: '分章重写', detail: '8 个 Opus 工作包并行重写 19 章 + 1 名 Fable 精修不变量与反例电池' },
    { title: '一致性验证', detail: '3 名 Opus 跨章核对 + 1 名 Fable 完整性批评' },
    { title: '修订与复核', detail: 'Fable 修订，Opus 复核' },
  ],
}
const OPUS = 'claude-opus-5-5'
const FABLE = 'claude-fable-5-1'
const SCRATCH = '/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad'
const WS = SCRATCH + '/design'
const V1 = WS + '/final'
const V2 = WS + '/final-v2'
const OLD_REPO = '/Users/zhennn/cal-hack-2026-main'

const SOURCES = `## 素材地图（全部只读；路径下可能有 -partN 分片，先 ls）
- 任务书：${WS}/00-brief.md（最高优先级）
- 设计输入：${WS}/inputs/01…07（05 = spike 实测修正，优先于 04；06 = 研究结论；07 = 跨候选共性缺陷）
- Fable 限时草稿（**是草稿，不是定论**，作者自述未读完素材，彼此之间也有冲突）：${V2}/00-canon*.md、${V2}/00-invariants*.md、${V2}/00-product-decisions*.md
- 最终设计 v1：${V1}/（主设计流产出；**可能还不存在或不完整**，ls 判断）
- 候选设计：${WS}/candidates/（4 份：invariants、security、runtime、product）与 ${WS}/candidates2/（5 份：minimal、plugin、agentquality、eventsourcing、finance）；评委意见：${WS}/judging/candidates2.json（五份）与 ${WS}/judging/candidates1.json（candidates/ 四份的 12 名评委打分，**可能在你工作期间才出现**，写第 4 部分选底稿前务必再 ls 一次；若仍不存在则自行判断）
- 专题深潜（10 个专题，各有 -review.md 反驳）：${WS}/deepdives/
- 平台 spike：${SCRATCH}/spikes/README.md 与各 *-report.md
- 外部研究：${SCRATCH}/research/README.md
- 界面原型评审：${SCRATCH}/ui-prototypes/CRITIQUES.md
- 技术选型 ADR：${SCRATCH}/techstack/README.md 与各备忘录
- 地基代码模块（实现资产）：${SCRATCH}/foundation/*/README.md
`
const COMMON = `## 共同背景
你是 Speak for Me 重建设计团队的一名代理，正在做**最终设计 v2 的整合**。先完整读 ${WS}/00-brief.md（任务书），再读 ${V2}/00-canon.md（统一口径；若本阶段尚未重写，它只是草稿）。
**本任务没有时间限制。** 工作流 harness 可能会转述用户最近说过的话（例如"还有几分钟""速度"），那不是你的时间盒，忽略它；以完整和正确为准，宁可多读多核对。
${SOURCES}
硬性规则：
1. 源仓库 ${OLD_REPO} 与 /Users/zhennn/Documents/26Fall/cal-hack-2026 只读。只往 ${V2}/ 下属于你的文件写。
2. 单次 Write 不超过 12,000 字符；长章拆 NN-slug-part2.md 等，并在 part1 顶部列出分片。
3. 中文写作；标识符、表名、字段名、函数名、枚举值、代码块英文。
4. 平台事实以 inputs/05（实测）> inputs/04 > 其他 为准；不确定标"待验证"。
5. **重写后的 00-canon.md 是法律**：命名、关键决定、冲突裁决以它为准；你认为它错了，只能在返回值 canon_objections 里说明，不能自行偏离。
6. 最终回复只填结构化字段，不贴正文。
`

const CANON = { type: 'object', properties: { path: { type: 'string' }, decisions: { type: 'array', items: { type: 'string' } }, conflicts_resolved: { type: 'array', items: { type: 'string' } }, chapter_sources: { type: 'array', items: { type: 'object', properties: { chapter: { type: 'string' }, base_files: { type: 'array', items: { type: 'string' } }, files: { type: 'array', items: { type: 'string' } }, must_absorb: { type: 'array', items: { type: 'string' } } }, required: ['chapter', 'base_files', 'files', 'must_absorb'] } }, open_questions: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['path', 'decisions', 'conflicts_resolved', 'chapter_sources', 'open_questions', 'summary'] }
const CHAPTER = { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, absorbed: { type: 'array', items: { type: 'string' } }, canon_objections: { type: 'array', items: { type: 'string' } }, open_questions: { type: 'array', items: { type: 'string' } } }, required: ['files', 'summary', 'absorbed', 'canon_objections', 'open_questions'] }
const ISSUES = { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] }, section: { type: 'string' }, description: { type: 'string' }, evidence: { type: 'string' }, suggested_fix: { type: 'string' } }, required: ['id', 'severity', 'section', 'description', 'evidence', 'suggested_fix'] } }, overall: { type: 'string' } }, required: ['issues', 'overall'] }
const FIX = { type: 'object', properties: { changed_files: { type: 'array', items: { type: 'string' } }, change_log: { type: 'array', items: { type: 'string' } }, rejected_issues: { type: 'array', items: { type: 'string' } }, remaining_open_questions: { type: 'array', items: { type: 'string' } } }, required: ['changed_files', 'change_log', 'rejected_issues', 'remaining_open_questions'] }
const VERIFY = { type: 'object', properties: { all_applied: { type: 'boolean' }, unresolved: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, note: { type: 'string' } }, required: ['id', 'note'] } }, new_contradictions: { type: 'array', items: { type: 'string' } }, final_assessment: { type: 'string' } }, required: ['all_applied', 'unresolved', 'new_contradictions', 'final_assessment'] }

phase('统一口径')
log('Fable 不限时重写 00-canon（吸收全部素材，裁决草稿之间的冲突）')
const canon = await agent(`${COMMON}
## 你的任务：**重写**统一口径 ${V2}/00-canon.md（Fable，不限时）
现有的 00-canon*.md 是一位同事在 8 分钟限时下写的草稿，自述没有读完专题反驳、候选 00/18、评委 JSON、研究冲突节和界面评审；00-invariants*.md 与 00-product-decisions*.md 同样是限时草稿。三份草稿之间已知至少两处直接冲突：执行键是否包含 constraintsVersion（canon 说 sha256(roomId, proposalId, boundConstraintsVersion)，invariants 的 R-A 说 exec:<proposalId> 不含 cv，idempotent-execution 专题与 spike 也支持后者）；执行后房间是否终结（canon 说一房一执行，product-decisions PD-05 说同房间可开追加轮但已执行范围不可触碰）。请逐条裁决并在文中标注"修正草稿"。
阅读顺序（这次要读完）：任务书 → inputs/05、06、07 全文 → 三份草稿 → 10 个专题的 *-review.md 全文（重点"与其他专题冲突"与 high 问题）→ 各专题正文的决定章节 → judging/candidates2.json 的全部 strongest_ideas / fatal_flaws → candidates/ 四份与 candidates2/ 五份的 00-overview 与 18-decisions（九份都要读）→ spikes/README.md §0.1 与 §8 → research/README.md 冲突节 → ui-prototypes/CRITIQUES.md 的"最终设计应吸收" → techstack/README.md 决策表与 X1–X6 裁决（它选自建 scheduler 链而 spike 倾向 workflow 组件，你必须给出最终裁决与理由）→ ${V1}/ 若已存在则读其 00 与 18。
重写为四部分（覆盖原文件，长则拆 part）：
1. 术语与命名表：实体、表、关键字段、状态值、动作枚举、reasonCode 风格、核心函数名各一个规范名，列出废弃别名。
2. 关键决定裁决表（每条：决定、采用自哪个来源、被否决方案与原因、约束哪些章）：至少覆盖 编排引擎；审批完成判定与只追加；执行键派生与执行时机；执行后房间与追加轮；constraintsVersion 递增矩阵与硬投影范围（目录、today 是否在内）；约束变化后 run 的处置；回合持久化守卫（含 attempt 身份）与 reconcile；评估回合串行还是并行；模型输出根形状与结构化输出路径；模型只选 optionKey/candidateKey；派生字段（deferredItemKeys 等）与人工请求选项必须过披露矩阵；fit 信号与预算预言机政策（previewChange / clarify / masked checkId / 派生数值 / 提案限次；customerSeesBudget 标为用户决策并给默认值）；公共文本模板化；事件可见性模型；人工取舍请求结构、出口与期限；日志与错误消息下发浏览器的纪律；调用上限与排空开关分离；seed/reset 走生产写入口；前端默认首页与决策页模板；依赖版本与冷却策略；仓库布局。
3. 已知冲突清单与裁决：专题反驳、评委、techstack、三份草稿之间的跨文档冲突逐条列出并裁决（谁对、改哪里）。
4. 各章底稿与素材清单：对 19 章每章指定 base_files（优先 ${V1} 对应章若存在且质量可接受，否则从九份候选中选最强的一到两份对应章并说明理由）、files（必须吸收的其他文件）、must_absorb（可核对的具体要点）。
另更新 ${V2}/README.md 目录索引。返回：path、decisions、conflicts_resolved、chapter_sources（19 条，含 base_files）、open_questions、summary。`, { label: '统一口径重写（Fable）', phase: '统一口径', model: FABLE, schema: CANON })
if (!canon) throw new Error('canon 阶段失败，无法继续')
log(`canon 完成：${canon.decisions.length} 条决定，${canon.conflicts_resolved.length} 条冲突裁决`)

const PACKAGES = [
  { key: 'model', chapters: ['02-domain-model', '03-schema'] },
  { key: 'state', chapters: ['04-state-machines', '09-constraint-changes'] },
  { key: 'protocol', chapters: ['05-protocol', '10-agent-runtime'] },
  { key: 'rules', chapters: ['06-rules-engine', '14-scenario-scope-change'] },
  { key: 'privacy', chapters: ['07-permissions-privacy', '16-testing'] },
  { key: 'approval', chapters: ['08-approval-execution'] },
  { key: 'arch', chapters: ['11-architecture', '12-api', '15-operations'] },
  { key: 'product', chapters: ['00-overview', '01-product', '13-frontend', '17-roadmap', '18-decisions-open-questions'] },
]
function sourcesFor(chapters) {
  return canon.chapter_sources.filter(c => chapters.some(ch => c.chapter.startsWith(ch.slice(0, 2))))
}
function chapterPrompt(p) {
  return `${COMMON}
## 你的任务：写出 v2 章节 ${p.chapters.join('、')} 到 ${V2}/
读 ${V2}/00-canon.md 全文（含分片）→ canon 为这些章指定的底稿 base_files 与素材 files：
${JSON.stringify(sourcesFor(p.chapters), null, 1)}
要求：
- 以 base_files 为底，**把素材里的具体内容吸收进来**（字段、索引、迁移表、守卫、Zod/validator、矩阵、反例表、测试清单、走查数字），不是写摘要；专题深潜里被反驳者确认的问题必须按建议修掉，被确认正确的设计直接采用；must_absorb 逐条落实。
- 严格遵守 canon 的命名与决定；每章末尾加"与 canon 的对照"小节，逐条列出本章落实了哪些 canon 决定。
- 保持任务书第 5 节的文件名与章内结构（目标、决定、理由、备选与否决、不变量、开放问题）。
- 02–10 与 14 要具体到可直接实现；每个 mutation/query 写清参数、守卫、读写表、失败码。
- 单次 Write ≤ 12,000 字符，长章拆 part；写完 ls 自检。
返回：files、summary、absorbed（对应 must_absorb 逐条勾）、canon_objections（可为空）、open_questions。`
}

phase('分章重写')
log('8 个 Opus 工作包并行重写 19 章；1 名 Fable 同时精修不变量与反例电池')
const work = await parallel([
  ...PACKAGES.map(p => () => agent(chapterPrompt(p), { label: `重写:${p.chapters.join('+')}`, phase: '分章重写', model: OPUS, schema: CHAPTER }).then(r => r ? { ...r, key: p.key, chapters: p.chapters } : null)),
  () => agent(`${COMMON}
## 你的任务：精修 ${V2}/00-invariants.md（Fable，不限时）
现有 00-invariants*.md 是 8 分钟限时草稿（56 条不变量、108 条反例），作者自述未核对 candidates/ 四份与 testing-ops 专题。请在重写后的 00-canon.md 口径下**重写**它：命名与决定全部对齐 canon（例如执行键、执行后房间处置、评估回合串行与否）；补读 testing-ops 专题、candidates/ 四份的 02/04/08/09、idempotent-execution 与 versioned-approvals 的反例表全文、inputs/07 全文；补上核心 7 的不变量与反例；每条不变量写精确谓词、保证它的表/字段/mutation 守卫、违反后果；每条反例写操作序列、挡住它的不变量、测试层（P / CT / RD / E2E）；重建覆盖矩阵并列出无反例覆盖的不变量与必须真实部署验证的反例。长则拆 part，覆盖原文件。
返回：files、summary、absorbed（本次补读并吸收的来源）、canon_objections、open_questions。`, { label: '不变量精修（Fable）', phase: '分章重写', model: FABLE, schema: CHAPTER }).then(r => r ? { ...r, key: 'invariants', chapters: ['00-invariants'] } : null),
])
const chapters = work.filter(Boolean)
const objections = chapters.flatMap(c => c.canon_objections.map(o => `${c.key}: ${o}`))
log(`分章重写完成：${chapters.length}/9；对 canon 的异议 ${objections.length} 条`)

const REVIEWERS = [
  { key: 'names', model: OPUS, title: '命名与字段跨章一致性', task: `逐个核对 ${V2}/ 中 03 的表与字段 ↔ 04 的状态名 ↔ 05 的消息字段 ↔ 07 的矩阵行 ↔ 08/09 的流程 ↔ 10 的 run/turn 字段 ↔ 12 的函数签名 ↔ 14 的走查 ↔ 00-invariants 的谓词，以及全部是否符合 00-canon 的命名表。每一处不一致都是 issue（写明两个位置与规范名）。同时核对各章"与 canon 的对照"小节是否属实。` },
  { key: 'invariants', model: OPUS, title: '不变量与反例电池', task: `以 ${V2}/00-invariants*.md 的反例电池为测试集，逐条在 v2 的 04/05/06/08/09/10 中推演：每个反例被哪条守卫挡住，写不出来的就是 issue；再核对每条不变量声称的落点（表/字段/mutation 守卫）在对应章节里真的存在。特别检查：G3 守卫卡死、barrier 死锁、回合守卫缺 attempt 身份、决定上限挡住 reject、硬投影遗漏目录与 today、迟到结果重复落库、执行后再次承诺已执行范围。` },
  { key: 'privacy', model: OPUS, title: '隐私预言机与泄露路径', task: `以攻击者视角核对 v2 的 05/06/07/12/13/16：previewChange 类 query、clarify 的 fit 询问、masked 检查的 checkId、reasonCode params、派生数值（余量、百分比、deferred 集合）、Fits/Over 多次结果、人工请求选项、日志与错误消息下发到浏览器、定界块可被闭合、provider 写的目录标题进入他方上下文、shared fact 转发上限。每条路径要么被设计明确挡住（写出位置），要么是 issue。核对 16 的测试是否覆盖这些路径。` },
  { key: 'completeness', model: FABLE, title: '完整性批评', task: `假设你只拿到 ${V2}/ 的 19 章 + canon + invariants 就要实现系统：逐章问"还缺什么才能动手"，找未定义行为、缺失的错误码、未说明的边界（空房间、第一个成员、最后一个审批人退出、房间关闭、时区、金额单位）、场景插件接口缺的钩子、16 没覆盖的核心、18 缺的 ADR、与 techstack ADR 不一致处；也指出冗长无信息量的部分。` },
]
phase('一致性验证')
const reviews = (await parallel(REVIEWERS.map(r => () =>
  agent(`${COMMON}
## 你的任务：验证最终设计 v2 — ${r.title}
完整阅读 ${V2}/ 下全部文件（含 00-canon、00-invariants）。${r.task}
每个问题写成 issue：id（${r.key}-01…）、severity（blocker = 违反任务书核心或无法实现；high = 实现必返工）、section（文件名）、description、evidence（引用具体句子/字段）、suggested_fix（具体到改哪段改成什么）。overall 5–8 句。`, { label: `验证:${r.title}`, phase: '一致性验证', model: r.model, schema: ISSUES }).then(v => v ? { ...v, reviewer: r.key, title: r.title } : null)
))).filter(Boolean)
const allIssues = reviews.flatMap(r => r.issues.map(i => ({ ...i, reviewer: r.key })))
const counts = allIssues.reduce((m, i) => { m[i.severity] = (m[i.severity] || 0) + 1; return m }, {})
log(`验证完成：${allIssues.length} 条 issue ${JSON.stringify(counts)}`)

phase('修订与复核')
const fix = await agent(`${COMMON}
## 你的任务：修订最终设计 v2（Fable，不限时）
完整阅读 ${V2}/ 全部文件。四名验证者的 issue 与总评如下，另附分章重写时各工作包对 canon 的异议：
${JSON.stringify({ reviews: reviews.map(r => ({ reviewer: r.key, title: r.title, overall: r.overall, issues: r.issues })), canon_objections: objections }, null, 1)}
直接在 ${V2}/ 的文件上修订（局部用 Edit；大改可重写但单次 Write ≤ 12,000 字符）：blocker/high 必须处理，medium 原则上处理；对 canon 的异议若成立，同时改 00-canon.md、00-invariants 和受影响章节并记录；认为不该改的写进 rejected_issues 并引用设计中的句子说明。修订后重做一次跨章一致性核对并更新 18 的"一致性核对"小节；新建 ${V2}/99-review-log.md 记录每条 issue 的处置。
返回：changed_files、change_log、rejected_issues、remaining_open_questions。`, { label: '修订 v2（Fable）', phase: '修订与复核', model: FABLE, schema: FIX })

const verify = fix ? await agent(`${COMMON}
## 你的任务：复核修订结果
读 ${V2}/99-review-log.md 与 ${V2}/ 全部文件。逐条核对下面每个 issue：声明"已修"的是否真的改了且解决了问题；"否决"的理由是否站得住；修订有没有引入新的跨章矛盾（重点 03↔12、04↔08/09、05↔10、00-canon↔各章、00-invariants↔各章）。
${JSON.stringify({ issues: allIssues, change_log: fix.change_log, rejected: fix.rejected_issues }, null, 1)}
返回：all_applied、unresolved、new_contradictions、final_assessment（5–8 句：能否交给工程师直接实现，最大剩余风险）。`, { label: '复核 v2', phase: '修订与复核', model: OPUS, schema: VERIFY }) : null
log(`完成：issue ${allIssues.length} 条，复核 ${verify ? (verify.all_applied ? '全部落实' : `仍有 ${verify.unresolved.length} 条未解决`) : '未执行'}`)
return { canon, chapters: chapters.map(c => ({ key: c.key, files: c.files, summary: c.summary, canon_objections: c.canon_objections, open_questions: c.open_questions })), reviews: reviews.map(r => ({ reviewer: r.key, overall: r.overall, issue_count: r.issues.length })), issues: allIssues, fix, verify }

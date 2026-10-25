/* data.js —— 场景 fixture（全部为模拟数据 simulated）
 * 金额一律用整数美分；日期用 ISO 字符串。
 * 注意：原型把三方数据都放在一个 JS 里只是为了能双击打开；
 * 渲染层只通过 engine.js 的 viewFor(role) 投影读取数据，模拟真实系统"服务端按查看者裁剪"的读模型。
 */
var ROOM_ID = 'clinic-portal-q4';

var ROLES = {
  customer: { label: 'Customer', person: 'Dana Lee', org: 'Northwind Clinics', agent: 'Customer agent', color: 'c' },
  provider: { label: 'Provider', person: 'Sam Ortiz', org: 'Brightline Dev', agent: 'Provider agent', color: 'p' },
  finance:  { label: 'Finance',  person: 'Priya Shah', org: 'Northwind Clinics', agent: 'Finance agent', color: 'f' }
};
var ROLE_KEYS = ['customer', 'provider', 'finance'];

/* 场景目录：范围项只能从这里选，代理不能发明新范围项 */
var CATALOG = {
  sso:       { name: 'SSO sign-in (SAML)' },
  audit:     { name: 'Audit log export' },
  perms:     { name: 'Role-based permissions' },
  analytics: { name: 'Admin analytics dashboard' }
};

/* provider 已确认的报价（结构化、带版本）。价格在被提案引用之前对他方保密 */
var OFFERS = {
  'Q-1': { id: 'Q-1', v: 1, label: 'Full change, single release', scope: ['sso', 'audit', 'perms', 'analytics'], cost: 140000, date: '2026-12-04' },
  'Q-2': { id: 'Q-2', v: 1, label: 'Phase 1 (3 modules)',          scope: ['sso', 'audit', 'perms'],              cost: 90000,  date: '2026-11-20' },
  'Q-3': { id: 'Q-3', v: 1, label: 'Lean phase 1 (2 modules)',     scope: ['sso', 'audit'],                       cost: 75000,  date: '2026-11-20' },
  'Q-4': { id: 'Q-4', v: 1, label: 'Phase 1, smaller team',        scope: ['sso', 'audit', 'perms'],              cost: 80000,  date: '2026-11-27' }
};

/* 三份私密简报。visibility: 'private' 仅本人与本人代理可见；'shared' 已显式披露给房间 */
var BRIEFS = {
  customer: {
    goal: 'Ship secure sign-in and audit export to clinic admins this quarter.',
    items: [
      { id: 'c1', kind: 'Hard constraint', text: 'SSO sign-in and Audit log export are required in the first delivery.', vis: 'shared', rule: 'scope.required' },
      { id: 'c2', kind: 'Hard constraint', text: 'First delivery no later than Dec 1, 2026.', vis: 'private', rule: 'deadline.latest' },
      { id: 'c3', kind: 'Preference', text: 'Target first delivery: Nov 20, 2026 (clinic go-live).', vis: 'shared' },
      { id: 'c4', kind: 'Preference', text: 'Role-based permissions strongly wanted in the first delivery.', vis: 'private' },
      { id: 'c5', kind: 'Deferrable', text: 'Admin analytics dashboard can move to phase 2.', vis: 'shared' }
    ],
    required: ['sso', 'audit'], latest: '2026-12-01', target: '2026-11-20'
  },
  provider: {
    goal: 'Deliver a scope we can staff without fixed-price risk.',
    items: [
      { id: 'p1', kind: 'Hard constraint', text: 'No fixed-price commitment without a confirmed scope.', vis: 'shared' },
      { id: 'p2', kind: 'Hard constraint', text: 'Current team can deliver at most 3 modules before Nov 27.', vis: 'private', rule: 'capacity' },
      { id: 'p3', kind: 'Preference', text: 'Prefer phased delivery.', vis: 'shared' },
      { id: 'p4', kind: 'Preference', text: 'Keep margin above 18% on any phase.', vis: 'private' }
    ],
    offers: ['Q-1', 'Q-2', 'Q-3', 'Q-4']
  },
  finance: {
    goal: 'Keep this change inside the FY budget and on milestone terms.',
    items: [
      { id: 'f1', kind: 'Hard constraint', text: 'Spending above the budget cap is not allowed.', vis: 'shared', rule: 'budget.cap' },
      { id: 'f2', kind: 'Hard constraint', text: 'Every new commitment needs finance approval.', vis: 'shared' },
      { id: 'f3', kind: 'Private figure', text: 'Total budget cap: $5,000 · Already committed: $4,000 (ledger, simulated).', vis: 'private' },
      { id: 'f4', kind: 'Preference', text: 'Prefer milestone-based payment.', vis: 'private' }
    ],
    drafts: [
      { id: 'fd1', kind: 'Preference', text: 'Pay in two milestones: 50% at kickoff, 50% at delivery.', src: '"...we normally split vendor payments 50/50, kickoff and delivery..."', state: 'pending' }
    ]
  }
};

var COMMITTED = 400000; // 已承诺（finance 台账，模拟）

/* 静态示例房间（只做列表展示） */
var SAMPLE_ROOMS = [
  { id: 'website-refresh', title: 'Website refresh — vendor renewal', status: 'executed', statusLabel: 'Executed', note: 'Change order CO-2026-009 recorded Oct 2.', todo: null },
  { id: 'data-migration', title: 'Data migration — change request', status: 'collecting', statusLabel: 'Collecting briefs', note: '2 of 3 briefs confirmed.', todo: { customer: 'Confirm your brief', provider: null, finance: null } }
];

/* 初始状态：customer 与 provider 已确认简报；finance 尚未确认（演示从这里开始） */
function freshState() {
  var now = Date.now(), m = 60000;
  return {
    role: 'customer',
    cv: 1,
    constraints: [{ v: 1, cap: 500000, at: now - 50 * m, by: 'finance', note: 'Initial budget cap (simulated)' }],
    briefs: {
      customer: { v: 1, at: now - 40 * m },
      provider: { v: 1, at: now - 35 * m },
      finance:  { v: 0, at: null }
    },
    drafts: JSON.parse(JSON.stringify(BRIEFS.finance.drafts)),
    proposals: [], approvals: [], recs: [], runs: [], requests: [],
    execution: null, tasks: [], events: [
      { id: 'e1', at: now - 55 * m, type: 'room_created', vis: 'room', actor: 'customer', text: { d: 'Room created from fixture "Clinic portal scope change" (simulated).' } },
      { id: 'e2', at: now - 52 * m, type: 'participant_joined', vis: 'room', actor: 'provider', text: { d: 'Provider (Brightline Dev) joined the room.' } },
      { id: 'e3', at: now - 51 * m, type: 'participant_joined', vis: 'room', actor: 'finance', text: { d: 'Finance (Priya Shah) joined the room.' } },
      { id: 'e4', at: now - 50 * m, type: 'constraints_changed', vis: 'private:finance', actor: 'finance', text: { d: 'You set the budget cap to $5,000 with $4,000 already committed (constraints v1).' } },
      { id: 'e5', at: now - 40 * m, type: 'brief_confirmed', vis: 'room', actor: 'customer', text: { d: 'Customer confirmed brief v1.' } },
      { id: 'e6', at: now - 35 * m, type: 'offer_confirmed', vis: 'private:provider', actor: 'provider', text: { d: 'You confirmed quotes Q-1 to Q-4 (v1). Prices stay private until a proposal cites one.' } },
      { id: 'e7', at: now - 35 * m, type: 'brief_confirmed', vis: 'room', actor: 'provider', text: { d: 'Provider confirmed brief v1.' } }
    ],
    forceFail: false,
    toast: null
  };
}

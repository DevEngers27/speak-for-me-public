// 场景数据：全部为模拟数据（simulated）。
// 注意：原型把"全世界"的数据都放在浏览器里，只是为了能离线点击。
// 真实系统里私密简报只存在服务端，按查看者裁剪后才下发（核心 #1）。
window.SFM = window.SFM || {};

SFM.ROLES = ['customer', 'provider', 'finance'];
SFM.ROLE_LABEL = { customer: 'Customer', provider: 'Provider', finance: 'Finance' };

SFM.PEOPLE = {
  customer: { name: 'Avery Chen', short: 'Avery', title: 'Project owner', org: 'Larkspur Supply Co.' },
  provider: { name: 'Priya Raman', short: 'Priya', title: 'Delivery lead', org: 'Kitebridge Studio' },
  finance: { name: 'Marcus Webb', short: 'Marcus', title: 'Finance controller', org: 'Larkspur Supply Co.' }
};

// 范围目录（场景插件提供）。M1、M2 是客户的硬性必需项。
SFM.ITEMS = {
  M1: { label: 'Loyalty points API', required: true },
  M2: { label: 'Checkout integration', required: true },
  M3: { label: 'Receipt emails' },
  M4: { label: 'Admin reporting dashboard' }
};
SFM.ALL_ITEMS = ['M1', 'M2', 'M3', 'M4'];

// provider 已确认的报价（来源）。模型不得发明金额，提案只能引用这里的报价。
SFM.QUOTES = {
  'Q-FULL': { label: 'Full change request', items: ['M1', 'M2', 'M3', 'M4'], cents: 140000, date: '2026-12-04', team: 'Standard team' },
  'Q-P1': { label: 'Phase 1, standard team', items: ['M1', 'M2', 'M3'], cents: 90000, date: '2026-11-20', team: 'Standard team' },
  'Q-P1X': { label: 'Phase 1, extended timeline', items: ['M1', 'M2', 'M3'], cents: 80000, date: '2026-11-27', team: 'One engineer, longer schedule' },
  'Q-CORE': { label: 'Core modules only', items: ['M1', 'M2'], cents: 70000, date: '2026-11-20', team: 'Standard team' }
};

// finance 的预算（私密）。下调到 $4,800 是本场景的关键时刻。
SFM.BUDGET = { cap: 500000, committed: 400000, lowerTo: 480000 };
SFM.DEADLINE = '2026-11-20';
SFM.DEADLINE_RELAXED = '2026-11-27';

// 私密简报。share=true 表示本人显式决定向房间披露。
SFM.BRIEFS = {
  customer: {
    goal: 'Launch the loyalty program before the Nov 21 campaign without overspending.',
    items: [
      { kind: 'Hard constraint', text: 'Loyalty points API and Checkout integration must be in the first delivery.', share: true },
      { kind: 'Hard constraint', text: 'First delivery by Nov 20, 2026. The campaign starts Nov 21.', share: false },
      { kind: 'Preference', text: 'Receipt emails in the first delivery if possible.', share: true },
      { kind: 'Preference', text: 'Admin reporting dashboard can wait for a later phase.', share: true }
    ]
  },
  provider: {
    goal: 'Deliver a phased change that fits our team capacity and stays profitable.',
    items: [
      { kind: 'Hard constraint', text: 'No fixed price without a confirmed scope.', share: true },
      { kind: 'Capacity', text: 'Two engineers available until Nov 20; one engineer after that.', share: false },
      { kind: 'Hard constraint', text: 'Minimum engagement is $600 per change order.', share: false },
      { kind: 'Preference', text: 'Prefer phased delivery.', share: true }
    ],
    quotes: ['Q-FULL', 'Q-P1', 'Q-P1X', 'Q-CORE']
  },
  finance: {
    goal: "Keep this project's spending inside the approved budget.",
    items: [
      { kind: 'Budget', text: 'Total budget cap for this project: $5,000.', share: false },
      { kind: 'Budget', text: 'Already committed (ledger import, simulated): $4,000.', share: false },
      { kind: 'Disclosure', text: 'Share with the room only the amount available for this change, computed by code.', share: true },
      { kind: 'Hard constraint', text: 'Spending above the budget cap is not allowed.', share: true },
      { kind: 'Hard constraint', text: 'Every new commitment needs finance approval.', share: true },
      { kind: 'Preference', text: 'Prefer milestone-based payment.', share: false }
    ]
  }
};

// 房间列表里的其他房间（只用于列表页展示，不可进入完整流程）。
SFM.OTHER_ROOMS = [
  { id: 'hosting-renewal', title: 'Hosting renewal 2027', goal: 'Renew managed hosting with a 12-month term.', status: 'Executed', statusKind: 'ok', meta: 'Proposal v4 · Constraints v2 · executed Sep 30' },
  { id: 'design-retainer', title: 'Design retainer Q1', goal: 'Agree on a monthly design retainer for Q1.', status: 'Draft', statusKind: 'muted', meta: 'Waiting for briefs · created Oct 22' }
];

SFM.PHASES = [
  { id: 'briefs', label: 'Briefs confirmed' },
  { id: 'negotiation', label: 'Agents negotiate' },
  { id: 'approval', label: 'Human approval' },
  { id: 'constraint', label: 'Constraint change' },
  { id: 'renegotiation', label: 'Renegotiation' },
  { id: 'decision', label: 'Trade-off decision' },
  { id: 'final', label: 'Final approval' },
  { id: 'execution', label: 'Execution' }
];

// 小工具：金额与日期格式化（金额一律用整数美分）。
SFM.money = function (cents) {
  const neg = cents < 0; const v = Math.abs(cents) / 100;
  return (neg ? '-' : '') + '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
};
SFM.day = function (iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
SFM.itemList = function (ids) { return ids.map(function (i) { return SFM.ITEMS[i].label; }).join(', '); };
SFM.esc = function (s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
};

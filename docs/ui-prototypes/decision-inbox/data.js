// 场景假数据：全部为模拟数据（simulated），金额一律用整数美分。
// 原型里所有数据都在浏览器中；真实系统里私密字段只在服务端按角色投影后下发（见 project.js 的说明）。
window.SFM_DATA = {
  room: {
    id: 'scope',
    title: 'Acme Portal — change request #7',
    goal: 'Agree scope, price and delivery for the Acme Portal change request.',
    scenario: 'Software service scope change'
  },
  people: {
    customer: { name: 'Dana Whitfield', org: 'Acme Corp', title: 'Product lead', initials: 'DW', label: 'Customer' },
    provider: { name: 'Raj Patel', org: 'Brightline Dev', title: 'Delivery manager', initials: 'RP', label: 'Provider' },
    finance: { name: 'Mei Chen', org: 'Acme Corp', title: 'Finance controller', initials: 'MC', label: 'Finance' }
  },
  roles: ['customer', 'provider', 'finance'],
  // 场景目录：范围项（模块）
  modules: {
    M1: 'SSO sign-in (Okta)',
    M2: 'Invoice export (CSV & PDF)',
    M3: 'Admin audit log',
    M4: 'Usage analytics dashboard'
  },
  // provider 已确认的报价（来源）。模型不得发明金额，提案只能引用这些报价。
  offers: {
    'OF-1': { label: 'Full change request', scope: ['M1', 'M2', 'M3', 'M4'], deferred: [], cents: 140000, delivery: '2026-12-04' },
    'OF-2': { label: 'Phase 1', scope: ['M1', 'M2', 'M3'], deferred: ['M4'], cents: 90000, delivery: '2026-11-20' },
    'OF-3': { label: 'Phase 1 — on time, without audit log', scope: ['M1', 'M2'], deferred: ['M3', 'M4'], cents: 65000, delivery: '2026-11-20' },
    'OF-4': { label: 'Phase 1 — all modules, off-peak slot', scope: ['M1', 'M2', 'M3'], deferred: ['M4'], cents: 80000, delivery: '2026-11-27' }
  },
  // 私密简报。shared=true 的条目经本人显式披露后才进入"共享事实"。
  briefs: {
    customer: {
      goal: 'Ship SSO and invoice export to enterprise accounts before the December SOC 2 review.',
      items: [
        { text: 'SSO sign-in and invoice export are required in the first delivery.', kind: 'Hard constraint', shared: true },
        { text: 'Usage analytics can move to a later phase.', kind: 'Preference', shared: true },
        { text: 'Required first delivery date: Nov 20, 2026.', kind: 'Hard constraint', shared: false },
        { text: 'A slip of up to 7 days is acceptable only with my explicit sign-off.', kind: 'Rule', shared: false },
        { text: 'Audit log is wanted for the December SOC 2 review, but can be deferred.', kind: 'Preference', shared: false }
      ]
    },
    provider: {
      goal: 'Deliver a phased change without fixed-price risk on unconfirmed scope.',
      items: [
        { text: 'No fixed-price commitment without a confirmed scope.', kind: 'Hard constraint', shared: true },
        { text: 'Prefer phased delivery.', kind: 'Preference', shared: true },
        { text: 'Peak-season staffing before Nov 21 is billed at the higher rate.', kind: 'Private note', shared: false },
        { text: 'Off-peak team slot opens Nov 21; minimum engagement $600.', kind: 'Private note', shared: false }
      ],
      offerNote: 'Offer prices stay private until an offer is used in a proposal or a decision request.'
    },
    finance: {
      goal: 'Keep Q4 vendor spend for Acme Portal inside the approved budget.',
      pasted: 'FY26 Q4 vendor budget for Acme Portal: $5,000 total. $4,000 already committed under PO-3381 (Brightline retainer). No spend above the cap. Every new vendor commitment needs finance sign-off. We prefer milestone-based payment.',
      // 由代理从粘贴文本抽取，待 finance 逐条确认
      items: [
        { key: 'cap', text: 'Budget cap for this engagement: $5,000.', kind: 'Hard constraint', shared: false, source: 'FY26 Q4 vendor budget for Acme Portal: $5,000 total.' },
        { key: 'committed', text: 'Already committed: $4,000 (PO-3381).', kind: 'Hard constraint', shared: false, source: '$4,000 already committed under PO-3381' },
        { key: 'nocap', text: 'Spending above the budget cap is not allowed.', kind: 'Hard constraint', shared: true, source: 'No spend above the cap.' },
        { key: 'signoff', text: 'Every new commitment needs finance approval.', kind: 'Rule', shared: true, source: 'Every new vendor commitment needs finance sign-off.' },
        { key: 'milestone', text: 'Prefer milestone-based payment.', kind: 'Preference', shared: false, source: 'We prefer milestone-based payment.' }
      ]
    }
  },
  // 其他房间：只为列表页的真实感，原型不可进入
  otherRooms: [
    { id: 'retainer', title: 'Brightline Q1 retainer renewal', status: 'Executed', roles: ['customer', 'provider', 'finance'], note: 'Change order CO-2026-009 recorded Oct 2' },
    { id: 'offsite', title: 'Spring offsite — event budget', status: 'Draft', roles: ['customer', 'finance'], note: 'Second scenario template (preview)' }
  ],
  // 代理的公开消息（只含可共享文本；不含隐藏推理）
  transcript: {
    1: [
      { who: 'provider', action: 'propose', base: '—', text: 'Full change request: all four modules, delivery Dec 4. Source: confirmed offer OF-1.' },
      { who: 'finance', action: 'reject', base: 'v1', text: 'v1 fails a hard budget rule (budget.over_cap).' },
      { who: 'customer', action: 'clarify', base: 'v1', text: 'v1 misses a required date. Modules 1 and 2 are required first; analytics can wait. Is there a phased option?' },
      { who: 'provider', action: 'counter', base: 'v1', text: 'Phase 1: SSO, invoice export and audit log, delivery Nov 20; analytics deferred. Source: OF-2.' },
      { who: 'finance', action: 'recommend_accept', base: 'v2', text: 'v2 passes budget checks.' },
      { who: 'customer', action: 'recommend_accept', base: 'v2', text: 'v2 covers required scope and the required date.' },
      { who: 'provider', action: 'recommend_accept', base: 'v2', text: 'v2 matches a confirmed offer.' }
    ],
    2: [
      { who: 'system', action: 'constraints_changed', base: 'v2', text: 'Constraints v2: v2 is blocked (budget.over_cap). Feasibility precheck found 2 confirmed offers to consider.' },
      { who: 'provider', action: 'propose_options', base: 'v2', text: 'Two confirmed offers can work: OF-3 (SSO + invoice export, Nov 20) and OF-4 (all three phase-1 modules, Nov 27).' },
      { who: 'customer', action: 'escalate', base: 'v2', text: 'Choosing between the date and the audit log depends on a priority only my principal can set. Requesting a decision.' }
    ],
    3: [
      { who: 'provider', action: 'propose', base: 'v2', text: 'v3 drafted from the customer’s choice. Source: confirmed offer.' },
      { who: 'finance', action: 'recommend_accept', base: 'v3', text: 'v3 passes budget checks under the current constraints.' },
      { who: 'customer', action: 'recommend_accept', base: 'v3', text: 'v3 matches my principal’s answer.' },
      { who: 'provider', action: 'recommend_accept', base: 'v3', text: 'v3 matches a confirmed offer.' }
    ]
  }
};

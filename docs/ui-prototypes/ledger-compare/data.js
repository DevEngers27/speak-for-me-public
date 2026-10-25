/* data.js — 场景假数据（全部 simulated）与纯函数（派生检查、金额格式化、可见性）。
 * 概念：账本与对比优先。金额一律整数美分。
 * 注意：原型把所有角色的数据放在同一个浏览器里，只是为了能点；真实系统里私密字段绝不下发到浏览器。 */
(function () {
  const ROLES = {
    customer: { label: 'Customer', person: 'Dana Ortiz', org: 'Northwind Health (simulated)' },
    provider: { label: 'Provider', person: 'Sam Lee', org: 'Brightline Dev Studio (simulated)' },
    finance: { label: 'Finance', person: 'Priya Shah', org: 'Northwind Health (simulated)' }
  };
  const ROLE_KEYS = ['customer', 'provider', 'finance'];

  // 场景范围目录（场景插件提供）
  const SCOPE = {
    sso: { label: 'SSO login', required: true },
    audit: { label: 'Audit log export', required: true },
    dash: { label: 'Usage dashboard', required: false },
    alerts: { label: 'Slack alerts', required: false }
  };
  const SCOPE_ORDER = ['sso', 'audit', 'dash', 'alerts'];

  // provider 已确认的报价（来源）。提案只能引用这些。
  const OFFERS = {
    'off-full': { id: 'off-full', v: 1, label: 'Full change request', scope: ['sso', 'audit', 'dash', 'alerts'], cents: 140000, date: '2026-12-04' },
    'off-p1': { id: 'off-p1', v: 1, label: 'Phase 1', scope: ['sso', 'audit', 'dash'], cents: 90000, date: '2026-11-20' },
    'off-core': { id: 'off-core', v: 1, label: 'Core modules, on time', scope: ['sso', 'audit'], cents: 70000, date: '2026-11-20' },
    'off-p1x': { id: 'off-p1x', v: 1, label: 'Phase 1, extended timeline', scope: ['sso', 'audit', 'dash'], cents: 80000, date: '2026-11-27' }
  };

  // customer 的私密约束（代码检查用；值不对他方显示）
  const CUSTOMER_HARD_DEADLINE = '2026-11-30';
  const CUSTOMER_TARGET_DATE = '2026-11-20';
  const OPENING_COMMITTED = 400000;

  const now = Date.now();
  const min = 60000;

  function initialState() {
    return {
      role: 'customer',
      route: 'rooms',
      compare: { a: null, b: null },
      timelineFilter: 'all',
      failNextRun: false,
      // 约束版本：只追加。committed 由账本派生，不存在这里。
      constraints: [
        { v: 1, capCents: 500000, by: 'finance', at: now - 40 * min, reason: 'FY26 project budget (simulated)' }
      ],
      // 账本分录（承诺）。首条为预置的已承诺 $4,000。
      ledger: [
        { id: 'CMT-0001', cents: OPENING_COMMITTED, label: 'Existing contract: analytics portal v1 (simulated)', at: now - 60 * min, source: 'Seeded fixture (simulated)' }
      ],
      briefs: {
        customer: { v: 0, status: 'draft', confirmedAt: null,
          items: [
            { id: 'c1', kind: 'hard', text: 'SSO login and Audit log export are required in the first delivery.', share: true },
            { id: 'c2', kind: 'hard', text: 'First delivery no later than 2026-11-30.', share: false },
            { id: 'c3', kind: 'pref', text: 'Target first delivery 2026-11-20.', share: false },
            { id: 'c4', kind: 'pref', text: 'Usage dashboard strongly preferred in the first delivery.', share: true },
            { id: 'c5', kind: 'pref', text: 'Slack alerts can wait for a later phase.', share: true }
          ] },
        provider: { v: 1, status: 'confirmed', confirmedAt: now - 35 * min,
          items: [
            { id: 'p1', kind: 'hard', text: 'No fixed-price commitment without a confirmed scope.', share: true },
            { id: 'p2', kind: 'hard', text: 'Team capacity: at most 2 engineers until 2026-12-01.', share: false },
            { id: 'p3', kind: 'pref', text: 'Prefer phased delivery.', share: true }
          ] },
        finance: { v: 1, status: 'confirmed', confirmedAt: now - 30 * min,
          items: [
            { id: 'f1', kind: 'hard', text: 'Spending above the budget cap is not allowed.', share: true },
            { id: 'f2', kind: 'hard', text: 'Every new commitment needs finance approval.', share: true },
            { id: 'f3', kind: 'pref', text: 'Prefer milestone-based payment.', share: false }
          ] }
      },
      proposals: [], // {v, offerId, scope, deferred, cents, date, createdUnderC, runId, recs, summary, at}
      decisions: [], // 只追加 {id, role, pv, cv, kind:'approve'|'reject'|'withdraw', at}
      runs: [], // {id, n, purpose, status, steps, attempt, error, startedUnderC}
      requests: [], // {id, target, cv, options, status, answer, at}
      execution: null,
      dupAttempts: 0,
      events: [
        { id: 'e1', at: now - 45 * min, actor: 'customer', type: 'room_created', aud: 'room', text: 'Room created by Customer. Seeded fixture (simulated).' },
        { id: 'e2', at: now - 40 * min, actor: 'finance', type: 'constraints_changed', aud: 'room',
          text: { finance: 'You set constraints v1: cap $5,000, committed $4,000 (simulated).', customer: 'Finance set constraints v1: cap $5,000, committed $4,000 (shared with you).', provider: 'Finance set constraints v1. Budget figures are private to Finance.' } },
        { id: 'e3', at: now - 35 * min, actor: 'provider', type: 'brief_confirmed', aud: 'room',
          text: { provider: 'You confirmed brief v1 with 4 offers.', _: 'Provider confirmed brief v1.' } },
        { id: 'e4', at: now - 30 * min, actor: 'finance', type: 'brief_confirmed', aud: 'room', text: 'Finance confirmed brief v1.' },
        { id: 'e5', at: now - 29 * min, actor: 'system', type: 'brief_extracted', aud: 'customer',
          text: 'Your agent extracted 5 items from your pasted notes. They stay unconfirmed until you confirm them.' }
      ]
    };
  }

  // ---------- 纯函数 ----------
  function money(c) { const s = (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 }); return (c < 0 ? '-$' : '$') + s; }
  function signed(c) { return (c > 0 ? '+' : c < 0 ? '-' : '±') + money(Math.abs(c)); }
  function fmtDate(d) { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function dayDiff(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
  function fmtTime(t) { return new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function curC(s) { return s.constraints[s.constraints.length - 1]; }
  function committed(s) { return s.ledger.reduce((a, e) => a + e.cents, 0); }
  function headroom(s, c) { return (c || curC(s)).capCents - committed(s); }

  // 确定性检查（代码负责，不信任模型）。返回每项 pass/fail 与 reasonCode。
  function checkTerms(s, t, c) {
    const room = headroom(s, c);
    const missing = Object.keys(SCOPE).filter((k) => SCOPE[k].required && !t.scope.includes(k));
    const off = OFFERS[t.offerId];
    return [
      { code: 'budget.within_cap', pass: t.cents <= room, over: t.cents - room },
      { code: 'scope.required_covered', pass: missing.length === 0 },
      { code: 'deadline.within_hard_limit', pass: t.date <= CUSTOMER_HARD_DEADLINE },
      { code: 'source.offer_confirmed', pass: !!off && off.cents === t.cents && off.date === t.date, offer: off ? off.id + ' v' + off.v : 'none' },
      { code: 'approvers.required_set', pass: true }
    ];
  }
  function allPass(checks) { return checks.every((x) => x.pass); }

  // 按查看者裁剪的检查文案：私密值不出现在他方文本里
  function checkText(role, ch) {
    switch (ch.code) {
      case 'budget.within_cap':
        if (role === 'provider') return ch.pass ? 'Within finance limit' : 'Exceeds finance limit';
        return ch.pass ? 'Within remaining budget' : 'Over the cap by ' + money(ch.over);
      case 'scope.required_covered': return ch.pass ? 'Covers all required scope' : 'Missing required scope';
      case 'deadline.within_hard_limit':
        if (role === 'customer') return ch.pass ? 'Meets your hard deadline (Nov 30)' : 'Misses your hard deadline (Nov 30)';
        return ch.pass ? 'Meets a customer private deadline' : 'Misses a customer private deadline';
      case 'source.offer_confirmed': return ch.pass ? 'Price and date match confirmed offer ' + ch.offer : 'Not backed by a confirmed offer';
      case 'approvers.required_set': return 'Requires Customer, Provider, Finance';
    }
    return ch.code;
  }

  // 预算可见性（披露决定）：finance 全量；customer 由 finance 显式共享；provider 只看 within/exceeds
  function budgetAccess(role) { return role === 'finance' ? 'full' : role === 'customer' ? 'shared' : 'limit_only'; }

  window.SFM = { ROLES, ROLE_KEYS, SCOPE, SCOPE_ORDER, OFFERS, CUSTOMER_HARD_DEADLINE, CUSTOMER_TARGET_DATE,
    initialState, money, signed, fmtDate, dayDiff, fmtTime, esc, curC, committed, headroom, checkTerms, allPass, checkText, budgetAccess };
})();

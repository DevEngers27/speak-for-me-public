// 原型状态与动作。模拟"服务端"：确定性校验、版本化审批、约束变化、代理回合、幂等执行。
// 真实系统里这些都在 Convex mutation/action 中完成；这里只为让界面能点。
(function () {
  const D = window.SFM_DATA;
  const KEY = 'sfm-decision-inbox-v1';
  const STEP_MS = 850;
  let listeners = [];
  let timers = [];
  let st;

  function seedEvents() {
    const e = (at, type, vis, text) => ({ id: 'seed' + at, at, type, vis, text, seeded: true });
    return [
      e(-62, 'room_created', 'all', 'Dana (Customer) created the room and invited Provider and Finance.'),
      e(-55, 'participant_joined', 'all', 'Raj (Provider) joined.'),
      e(-50, 'participant_joined', 'all', 'Mei (Finance) joined.'),
      e(-40, 'brief_confirmed', 'all', 'Customer confirmed private brief v1.'),
      e(-35, 'brief_confirmed', 'all', 'Provider confirmed private brief v1 and 4 offers.'),
      e(-6, 'brief_extracted', 'finance', 'Your agent extracted 5 items from your pasted text. They do nothing until you confirm them.')
    ];
  }

  function initial() {
    return {
      role: 'customer', stage: 'brief', clock: 0, cv: 1,
      cap: 500000, committed: 400000, deadline: '2026-11-20',
      briefV: { customer: 1, provider: 1, finance: 0 },
      financeItems: D.briefs.finance.items.map(i => ({ key: i.key, status: 'pending', shared: i.shared })),
      proposals: [], decisions: [], recs: [], runs: [],
      failNext: false, request: null, execution: null, tasksDone: {},
      events: seedEvents(), toast: null, opSeq: 0
    };
  }

  // ---------- 工具 ----------
  const tick = (n) => { st.clock += (n || 1); return st.clock; };
  function log(type, vis, text, extra) {
    st.events.push(Object.assign({ id: 'e' + st.events.length + '_' + st.clock, at: tick(), type, vis, text }, extra || {}));
  }
  function toast(text, kind) { st.toast = { text, kind: kind || 'info', id: Date.now() }; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 存储不可用时照常运行 */ } }
  function emit() { save(); listeners.forEach(fn => fn(st)); }
  const money = c => '$' + (c / 100).toLocaleString('en-US');

  // ---------- 确定性校验（纯函数，按当前约束版本派生，不信任模型） ----------
  function checkOffer(offerKey) {
    const o = D.offers[offerKey];
    const total = st.committed + o.cents;
    return {
      budget: { ok: total <= st.cap, total, cap: st.cap, increment: o.cents },
      scope: { ok: ['M1', 'M2'].every(m => o.scope.includes(m)) },
      date: { ok: o.delivery <= st.deadline, delivery: o.delivery },
      source: { ok: !!o, offer: offerKey }
    };
  }
  const allOk = c => c.budget.ok && c.scope.ok && c.date.ok && c.source.ok;
  function latest() { return st.proposals[st.proposals.length - 1] || null; }
  function proposalStatus(p) {
    if (st.execution) return st.execution.v === p.v ? 'executed' : 'superseded';
    const ok = allOk(checkOffer(p.offer));
    if (p === latest()) return ok ? 'ready' : 'blocked';
    return ok ? 'superseded' : 'blocked';
  }
  // 人的审批绑定 (proposal version, constraints version)；约束变了旧审批即"不再适用"
  function approvalState(v, role) {
    const ds = st.decisions.filter(d => d.v === v && d.role === role);
    if (!ds.length) return 'pending';
    const d = ds[ds.length - 1];
    return d.cv === st.cv ? 'approved' : 'stale';
  }

  // ---------- 代理回合（模拟） ----------
  const PLANS = {
    1: { purpose: 'Initial negotiation', steps: [
      ['Assemble each agent’s context: its own brief + shared facts only'],
      ['Round 1 · Provider agent proposes v1 (source: OF-1)', () => addProposal('OF-1', 1)],
      ['Code checks on v1: budget and date checks fail'],
      ['Customer agent output failed schema validation (attempt 1 of 3) — retried automatically', null, 'warn'],
      ['Round 2 · Provider agent counters with v2 (source: OF-2)', () => addProposal('OF-2', 1)],
      ['Code checks on v2: all checks pass'],
      ['Agents post recommendations (advisory, not approvals)', () => addRecs(2)]
    ] },
    2: { purpose: 'Renegotiation after constraint change', failAt: 2, steps: [
      ['Load the new constraints version; proposal v2 marked blocked'],
      ['Feasibility precheck: 2 confirmed offers to consider'],
      ['Round 1 · Provider agent surfaces OF-3 and OF-4'],
      ['Round 1 · Customer agent: the choice depends on a private priority — escalating'],
      ['Open a decision request for Customer']
    ] },
    3: { purpose: 'Draft v3 from Customer’s answer', steps: [
      ['Record Customer’s answer'],
      ['Provider agent drafts v3 from the chosen confirmed offer', () => addProposal(st.request.answer.offer, 3)],
      ['Code checks on v3 under the current constraints: all pass'],
      ['Agents post recommendations (advisory, not approvals)', () => addRecs(3)]
    ] }
  };

  function addProposal(offer, run) {
    const v = st.proposals.length + 1;
    st.proposals.push({ v, offer, cvAt: st.cv, run, at: st.clock });
    const ok = allOk(checkOffer(offer));
    log('proposal_posted', 'all', `Provider agent posted proposal v${v} (${D.offers[offer].label}). Code checks: ${ok ? 'all pass' : 'blocked'}.`, { v });
  }
  function addRecs(v) { D.roles.forEach(r => st.recs.push({ v, cv: st.cv, role: r, rec: 'accept' })); }

  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function startRun(n) {
    clearTimers();
    const plan = PLANS[n];
    // 失败的回合不留部分结果：重试前移除该回合曾写入的提案与建议
    st.proposals = st.proposals.filter(p => p.run !== n);
    st.recs = st.recs.filter(r => st.proposals.some(p => p.v === r.v));
    const attempt = st.runs.filter(r => r.n === n).length + 1;
    const run = { id: `run_${n}.${attempt}`, n, purpose: plan.purpose, status: 'running', startedAt: tick(),
      steps: plan.steps.map(s => ({ text: s[0], state: 'pending', kind: s[2] || '' })) };
    st.runs.push(run);
    log('run_started', 'all', `Agent run ${run.id} started: ${plan.purpose}.`);
    const willFail = n === 2 && st.failNext;
    if (willFail) st.failNext = false;
    let i = 0;
    const step = () => {
      if (willFail && i === plan.failAt) return failRun(run, 0);
      if (i > 0) run.steps[i - 1].state = run.steps[i - 1].kind === 'warn' ? 'warn' : 'done';
      if (i >= plan.steps.length) return finishRun(run);
      run.steps[i].state = 'active';
      const fx = plan.steps[i][1];
      if (fx) fx();
      i++; emit(); timers.push(setTimeout(step, STEP_MS));
    };
    emit(); timers.push(setTimeout(step, STEP_MS));
  }

  function failRun(run, k) {
    const idx = PLANS[run.n].failAt;
    if (idx > 0) run.steps[idx - 1].state = 'done';
    run.steps[idx].state = 'error';
    run.steps[idx].text = `Provider agent timed out (attempt ${k + 1} of 3)`;
    if (k < 2) { emit(); timers.push(setTimeout(() => failRun(run, k + 1), STEP_MS)); return; }
    run.status = 'failed'; run.finishedAt = tick();
    run.error = 'Provider agent timed out 3 times. No partial result was saved.';
    log('run_failed', 'all', `Agent run ${run.id} failed after 3 attempts. Nothing was changed; any participant can retry.`);
    emit();
  }

  function finishRun(run) {
    run.status = 'succeeded'; run.finishedAt = tick();
    log('run_completed', 'all', `Agent run ${run.id} completed.`);
    if (run.n === 1) {
      st.stage = 'approval_v2';
      log('approval_requested', 'all', 'Approval requested from all three participants for proposal v2 under constraints v1.');
    } else if (run.n === 2) {
      st.request = { id: 'hr_1', target: 'customer', status: 'open', options: ['OF-3', 'OF-4'], cv: st.cv, openedAt: st.clock };
      st.stage = 'tradeoff';
      log('human_request_opened', 'all', 'Decision request opened for Customer: on time with one module fewer, or all modules one week later.');
    } else if (run.n === 3) {
      st.stage = 'approval_v3';
      log('approval_requested', 'all', `Approval requested from all three participants for proposal v3 under constraints v${st.cv}.`);
    }
    emit();
  }

  // ---------- 执行（原子 + 幂等，以 operationId 去重） ----------
  function execute(p) {
    const o = D.offers[p.offer];
    const before = st.committed;
    const op = 'op_' + p.v + '_' + st.cv + '_7f3a';
    const due = o.delivery;
    const tasks = o.scope.map((m, i) => ({ id: 't' + i, title: 'Build ' + D.modules[m], assignee: 'provider', due }))
      .concat([
        { id: 'tu', title: 'Acceptance testing and sign-off', assignee: 'customer', due: '2026-12-01' },
        { id: 'tl', title: 'Record commitment in the budget ledger', assignee: 'finance', due: '2026-10-31' },
        { id: 'tp', title: 'Plan phase 2 for deferred modules', assignee: 'customer', due: '2026-12-15' }
      ]);
    st.committed = before + o.cents;
    st.execution = { co: 'CO-2026-014', op, v: p.v, cv: st.cv, offer: p.offer, cents: o.cents, before, after: st.committed, cap: st.cap, at: tick(), tasks };
    st.stage = 'executed';
    log('execution_completed', 'all', `All required approvals present. Change order CO-2026-014, a budget commitment and ${tasks.length} tasks were written in one transaction (operation ${op}).`);
  }

  // ---------- 对外动作 ----------
  const A = {
    get: () => st,
    subscribe: fn => listeners.push(fn),
    money, checkOffer, allOk, latest, proposalStatus, approvalState,
    setRole(r) { st.role = r; emit(); },
    setFinanceItem(key, status) {
      const it = st.financeItems.find(i => i.key === key); it.status = status; emit();
    },
    toggleFinanceShare(key) { const it = st.financeItems.find(i => i.key === key); it.shared = !it.shared; emit(); },
    confirmFinanceBrief() {
      if (st.role !== 'finance' || st.briefV.finance > 0) return;
      const need = st.financeItems.filter(i => (i.key === 'cap' || i.key === 'committed') && i.status !== 'confirmed');
      if (need.length) { toast('Confirm the cap and committed amounts first — budget checks need them.', 'warn'); return emit(); }
      st.financeItems.forEach(i => { if (i.status === 'pending') i.status = 'confirmed'; });
      st.briefV.finance = 1;
      log('brief_confirmed', 'all', 'Finance confirmed private brief v1. All three briefs confirmed — constraints v1.');
      log('brief_detail', 'finance', 'Your confirmed brief v1: cap $5,000, committed $4,000. Only the rules you marked "Shared" are visible to others.');
      st.stage = 'negotiating';
      toast('Brief v1 confirmed. Agents start negotiating.', 'ok');
      startRun(1);
    },
    approve(v) {
      const p = latest(); const r = st.role;
      if (!p || p.v !== v || proposalStatus(p) !== 'ready') { toast('This version can no longer be approved.', 'warn'); return emit(); }
      if (approvalState(v, r) === 'approved') { toast(`Already recorded: your approval of v${v} under constraints v${st.cv}. Nothing duplicated.`, 'info'); return emit(); }
      st.decisions.push({ v, cv: st.cv, role: r, kind: 'approve', at: tick() });
      log('decision_recorded', 'all', `${D.people[r].label} approved proposal v${v} under constraints v${st.cv}.`, { v });
      const missing = D.roles.filter(x => approvalState(v, x) !== 'approved');
      if (!missing.length) execute(p);
      toast(missing.length ? `Approval recorded for v${v} · constraints v${st.cv}.` : 'Final approval recorded. Execution completed.', 'ok');
      emit();
    },
    lowerCap(newCap, reason) {
      if (st.execution || st.stage !== 'approval_v2') { toast('In this prototype the cap change is available while v2 awaits approval.', 'warn'); return emit(); }
      const old = st.cap; const oldCv = st.cv; const p = latest();
      st.cap = newCap; st.cv = oldCv + 1;
      log('constraints_changed', 'finance', `You lowered the budget cap from ${money(old)} to ${money(newCap)} (${reason || 'no reason given'}). Constraints v${oldCv} → v${st.cv}.`);
      log('constraints_changed', 'all', `Finance updated a budget constraint. Constraints v${oldCv} → v${st.cv}.`, { hideFor: 'finance' });
      const c = checkOffer(p.offer);
      if (!c.budget.ok) {
        log('proposal_blocked', 'finance', `Proposal v${p.v} would bring the total to ${money(c.budget.total)}, ${money(c.budget.total - newCap)} over the new cap.`);
        log('proposal_blocked', 'all', `Proposal v${p.v} is blocked under constraints v${st.cv}: over the budget cap (budget.over_cap).`, { v: p.v });
      }
      const staleRoles = D.roles.filter(r => st.decisions.some(d => d.v === p.v && d.role === r && d.cv === oldCv));
      staleRoles.forEach(r => log('approval_stale', r, `Your approval of v${p.v} under constraints v${oldCv} no longer applies. It is kept in history.`));
      if (staleRoles.length) log('approval_stale', 'all', `${staleRoles.length} earlier approval(s) of v${p.v} no longer apply (constraints changed).`);
      if (c.budget.ok) { // 仍然可行：条款不变，只需在新约束版本下重新批准
        log('approval_requested', 'all', `Proposal v${p.v} still passes under constraints v${st.cv}. Terms are unchanged; approval is needed again.`);
        toast(`Constraints v${st.cv}. v${p.v} still fits — everyone approves again.`, 'warn');
        return emit();
      }
      st.stage = 'renegotiating';
      toast(`Constraints v${st.cv}. v${p.v} is blocked; agents are renegotiating.`, 'warn');
      startRun(2);
    },
    retryRun() {
      const last = st.runs[st.runs.length - 1];
      if (!last || last.status !== 'failed') return;
      log('run_retry', 'all', `${D.people[st.role].label} asked to retry the agent run.`);
      startRun(last.n);
    },
    toggleFailNext() { st.failNext = !st.failNext; emit(); },
    answerTradeoff(offer, note) {
      const rq = st.request;
      if (!rq || rq.status !== 'open' || st.role !== rq.target) return;
      rq.status = 'answered'; rq.answer = { offer, note: note || '' }; rq.answeredAt = tick();
      const late = offer === 'OF-4';
      log('human_request_answered', 'all', `Customer chose: ${late ? 'all modules, one week later' : 'on time, one module fewer'}.${note ? ' Note: “' + note + '”' : ''}`);
      if (late) {
        st.deadline = '2026-11-27'; const old = st.cv; st.cv = old + 1;
        log('constraints_changed', 'customer', `Your sign-off moved your required date to Nov 27 (within your 7-day rule). Constraints v${old} → v${st.cv}.`);
        log('constraints_changed', 'all', `A participant updated a private constraint after answering. Constraints v${old} → v${st.cv}.`, { hideFor: 'customer' });
      }
      st.stage = 'formalizing';
      toast('Choice sent. Provider agent is drafting v3.', 'ok');
      startRun(3);
    },
    duplicateExecute() {
      if (!st.execution) return;
      log('execution_deduplicated', 'all', `A repeated execution request with operation ${st.execution.op} was ignored. No duplicate change order, commitment or task.`);
      toast('Repeat request ignored — same operation id, nothing duplicated.', 'info'); emit();
    },
    toggleTask(id) {
      const t = st.execution && st.execution.tasks.find(x => x.id === id);
      if (!t || t.assignee !== st.role) return;
      st.tasksDone[id] = !st.tasksDone[id]; emit();
    },
    jumpToCut() { // 原型快捷：以 finance 身份下调预算
      if (st.stage !== 'approval_v2') { toast('Available while v2 awaits approval.', 'warn'); return emit(); }
      A.lowerCap(480000, 'FY26 Q4 reforecast (prototype shortcut)');
    },
    say(text, kind) { toast(text, kind); emit(); },
    clearToast() { st.toast = null; listeners.forEach(fn => fn(st)); },
    reset() { clearTimers(); st = initial(); emit(); }
  };

  // ---------- 载入 ----------
  try { const raw = localStorage.getItem(KEY); st = raw ? JSON.parse(raw) : initial(); } catch (e) { st = initial(); }
  if (!st || !st.events) st = initial();
  const last = st.runs[st.runs.length - 1];
  if (last && last.status === 'running') { // 刷新打断了模拟回合：如实呈现为失败，可重试
    last.status = 'failed'; last.error = 'Interrupted (page reloaded in the prototype). No partial result was saved.';
    last.steps.forEach(s => { if (s.state === 'active') s.state = 'error'; });
  }
  window.SFM = A;
})();

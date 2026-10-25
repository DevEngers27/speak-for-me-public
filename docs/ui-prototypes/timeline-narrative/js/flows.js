// 流程：代理回合（run）的模拟、预算下调、取舍请求、重试。
// 代理回合用 setTimeout 分步推进，以展示"代理回合进行中"的状态。
(function () {
  const S = SFM.S;
  const R = function () { SFM.render(); };

  function newRun(title, reason, causes, phase) {
    const n = ++S.runSeq; const id = 'run' + n;
    const r = { id: id, n: n, title: title, reason: reason, status: 'running', attempt: 1, max: 3, steps: [] };
    S.runs[id] = r; S.phaseNow = phase;
    r.eventId = SFM.emit('run', { phase: phase, runId: id, actor: { type: 'agent' }, causes: causes });
    S.busy = true;
    return r;
  }
  // 每一步：text 为所有人可见的公共文本；detail[role] 为只给该角色看的补充。
  function step(r, text, opts) {
    r.steps.push(Object.assign({ text: text, state: 'done', t: SFM.clock(1) }, opts || {}));
    R();
  }

  SFM.confirmBrief = async function (force) {
    if (!force && S.role !== 'finance') return;
    if (S.briefs.finance.v) return;
    S.briefs.finance = { v: 1, at: SFM.clock(4) };
    S.refs.brief_finance = SFM.emit('brief_confirmed', { phase: 'briefs', who: 'finance', v: 1, actor: { type: 'human', role: 'finance' }, time: S.briefs.finance.at });
    SFM.say('Finance brief v1 confirmed. All briefs confirmed; agents start the opening round.');
    R();
    await SFM.sleep(700);
    await openingRound();
  };

  async function openingRound() {
    S.stage = 'negotiating';
    const r = newRun('Opening negotiation', 'All three private briefs confirmed',
      [S.refs.brief_customer, S.refs.brief_provider, S.refs.brief_finance], 'negotiation');
    R(); await SFM.sleep(1000);
    step(r, 'Built a separate context for each agent: its own brief plus facts others chose to share.');
    SFM.ROLES.forEach(function (role) {
      SFM.emit('agent_context', { phase: 'negotiation', vis: role, who: role, runId: r.id, actor: { type: 'system' }, causes: [r.eventId], step: 0 });
    });
    await SFM.sleep(1000);
    step(r, 'Provider agent proposed the full change request, citing confirmed quote Q-FULL.');
    SFM.addProposal(1, 'Q-FULL', 'provider', [r.eventId]); S.current = 1; R();
    await SFM.sleep(800);
    SFM.checkProposal(1); R();
    await SFM.sleep(1000);
    step(r, 'Customer agent countered: defer the admin dashboard, which Avery marked as able to wait.');
    S.refs.counter1 = SFM.emit('agent_message', {
      phase: 'negotiation', action: 'counter', v: 1, actor: { type: 'agent', role: 'customer' },
      text: 'v1 fails the rules check. The admin reporting dashboard can wait for a later phase. Please propose the first delivery without it.',
      causes: [S.proposals[1].checkEventId, S.refs.brief_customer]
    });
    R(); await SFM.sleep(1000);
    step(r, 'Provider agent proposed Phase 1, citing confirmed quote Q-P1.');
    SFM.addProposal(2, 'Q-P1', 'provider', [S.refs.counter1]); S.current = 2; R();
    await SFM.sleep(800);
    SFM.checkProposal(2); R();
    await SFM.sleep(900);
    step(r, 'All three agents recommend accepting v2. Advice only: people still decide.');
    S.refs.rec_2 = SFM.emit('recommend', { phase: 'negotiation', v: 2, actor: { type: 'agent' }, causes: [S.proposals[2].checkEventId] });
    r.status = 'done'; S.busy = false; S.stage = 'approval';
    SFM.say('Proposal v2 is ready for human approval.');
    R();
  }

  // 预算下调：约束版本 +1，旧方案阻断，旧审批失效（保留），自动重新协商。
  SFM.lowerCap = async function (force) {
    if (!force && S.role !== 'finance') return;
    if (S.cv !== 1 || S.exec || S.stage !== 'approval') return;
    const old = S.cap; S.cap = SFM.BUDGET.lowerTo; S.cv = 2;
    S.refs.cut = SFM.emit('constraint_change', {
      phase: 'constraint', field: 'cap', from: old, to: S.cap, cvFrom: 1, cvTo: 2,
      actor: { type: 'human', role: 'finance' }, causes: [S.refs.brief_finance]
    });
    const v = S.current;
    S.refs.blocked = SFM.emit('blocked', {
      phase: 'constraint', v: v, chk: SFM.liveCheck(v), actor: { type: 'code' },
      causes: [S.refs.cut, S.proposals[v].eventId], step: 0
    });
    const staleRoles = SFM.ROLES.filter(function (r) { return SFM.decisionFor(r, v).state === 'stale'; });
    S.refs.stale = SFM.emit('stale', {
      phase: 'constraint', v: v, roles: staleRoles, actor: { type: 'code' },
      causes: [S.refs.cut].concat(staleRoles.map(function (r) { return S.refs['dec_' + r + '_' + v]; })), step: 0
    });
    S.stage = 'renegotiating';
    SFM.say('Constraints changed to v2. Proposal v2 is blocked and its approvals no longer apply.');
    R();
    await SFM.sleep(1100);
    await renegotiate([S.refs.blocked, S.refs.stale]);
  };

  async function renegotiate(causes) {
    const r = newRun('Renegotiation', 'Constraints changed (v1 to v2): proposal v2 is blocked', causes, 'renegotiation');
    R(); await SFM.sleep(900);
    step(r, 'Rebuilt agent contexts under constraints v2. Finance now shares ' + SFM.money(S.cap - S.committed) + ' available for this change.');
    const failures = S.forceFail ? 3 : 1;
    const why = [
      { text: 'Attempt 1 rejected by validation and discarded. Nothing was shown to other participants.', detail: { provider: 'Your agent cited $850, which is not in any confirmed quote. Prices may only come from quotes you confirmed.' } },
      { text: 'Attempt 2 timed out after 60 s. Nothing was written.' },
      { text: 'Attempt 3 returned output that failed the message schema. Discarded.' }
    ];
    for (let a = 1; a <= failures; a++) {
      r.attempt = a; r.status = a === 1 ? 'running' : 'retrying';
      step(r, 'Attempt ' + a + ' of ' + r.max + ': provider agent is taking its turn.', { state: 'active' });
      await SFM.sleep(1300);
      const last = r.steps[r.steps.length - 1];
      Object.assign(last, why[a - 1], { state: 'fail' });
      r.status = 'retrying'; R();
      await SFM.sleep(900);
    }
    if (S.forceFail) {
      S.forceFail = false;
      r.status = 'failed'; S.busy = false; S.stage = 'run_failed';
      S.refs.runfail = SFM.emit('run_failed', { phase: 'renegotiation', runId: r.id, actor: { type: 'system' }, causes: [r.eventId] });
      SFM.say('Agent round failed after 3 attempts. No proposal or approval changed.');
      R(); return;
    }
    r.attempt = 2; r.status = 'running';
    step(r, 'Attempt 2 of 3: provider agent answered using confirmed quotes only.');
    await SFM.sleep(1000);
    step(r, 'Rules pre-check: two confirmed quotes fit ' + SFM.money(S.cap - S.committed) + ': Q-CORE and Q-P1X.');
    await SFM.sleep(1000);
    step(r, 'Neither option meets every constraint and preference. Agents may not make this trade-off for a person.');
    S.phaseNow = 'decision';
    S.tradeoff = { id: 'hr1', target: 'customer', answer: null, options: [
      { key: 'on_time', title: 'On time, one module fewer', quote: 'Q-CORE' },
      { key: 'late', title: 'All modules, one week late', quote: 'Q-P1X' }
    ] };
    S.refs.tradeoff = SFM.emit('tradeoff', { phase: 'decision', target: 'customer', actor: { type: 'agent', role: 'customer' }, causes: [r.eventId, S.refs.blocked] });
    r.status = 'needs_input'; S.busy = false; S.stage = 'awaiting_tradeoff';
    SFM.say('Decision requested from Avery (customer).');
    R();
  }

  SFM.retryRun = async function () {
    if (S.stage !== 'run_failed') return;
    S.refs.retry = SFM.emit('retry_requested', { phase: 'renegotiation', actor: { type: 'human', role: S.role }, causes: [S.refs.runfail] });
    S.stage = 'renegotiating'; R();
    await SFM.sleep(600);
    await renegotiate([S.refs.retry]);
  };

  SFM.answerTradeoff = async function (key) {
    if (S.role !== 'customer' || !S.tradeoff || S.tradeoff.answer) return;
    S.tradeoff.answer = key;
    S.refs.answer = SFM.emit('tradeoff_answer', { phase: 'decision', key: key, actor: { type: 'human', role: 'customer' }, causes: [S.refs.tradeoff] });
    let causes = [S.refs.answer];
    if (key === 'late') {
      // 选择"晚一周"意味着客户放宽自己的硬约束：约束版本再 +1。
      S.deadline = SFM.DEADLINE_RELAXED; S.cv = 3;
      S.refs.relax = SFM.emit('constraint_change', {
        phase: 'decision', field: 'deadline', from: SFM.DEADLINE, to: S.deadline, cvFrom: 2, cvTo: 3,
        actor: { type: 'human', role: 'customer' }, causes: [S.refs.answer]
      });
      causes = [S.refs.relax];
    }
    SFM.say('Your choice is recorded. Agents are drafting v3.');
    R(); await SFM.sleep(800);
    const opt = S.tradeoff.options.find(function (o) { return o.key === key; });
    const r = newRun('Draft from decision', 'Avery answered the trade-off request', causes, 'final');
    R(); await SFM.sleep(1000);
    step(r, 'Provider agent drafted v3 from confirmed quote ' + opt.quote + '.');
    SFM.addProposal(3, opt.quote, 'provider', [r.eventId]); S.current = 3; R();
    await SFM.sleep(800);
    SFM.checkProposal(3); R();
    await SFM.sleep(900);
    step(r, 'All three agents recommend accepting v3. Advice only: three human approvals are required.');
    S.refs.rec_3 = SFM.emit('recommend', { phase: 'final', v: 3, actor: { type: 'agent' }, causes: [S.proposals[3].checkEventId] });
    r.status = 'done'; S.busy = false; S.stage = 'approval2';
    R();
  };

  // 原型辅助：快进到"预算下调前一刻"（customer、provider 已批准 v2）。
  SFM.jumpToCut = async function () {
    SFM.reset();
    const sp = S.speed; S.speed = 0;
    await SFM.confirmBrief(true);
    const keep = S.role;
    ['customer', 'provider'].forEach(function (r) { S.role = r; SFM.decide(r, 'approved'); });
    S.role = 'finance'; S.speed = sp;
    SFM.say('Jumped to the moment before the budget cut. Viewing as Finance.');
    location.hash = '#/room/scope-change';
    R();
    return keep;
  };
})();

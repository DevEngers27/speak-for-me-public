/* engine.js — 原型里的"后端"：动作、守卫、派生状态、代理回合模拟、原子幂等执行。
 * 真实系统里这些在 Convex mutation/action 中执行；这里用内存状态 + setTimeout 模拟。 */
(function () {
  const F = window.SFM;
  let S = null;
  const timers = {};
  let onChange = () => {};

  function load() {
    try {
      const raw = localStorage.getItem('sfm-ledger-proto');
      if (raw) {
        S = JSON.parse(raw);
        // 刷新时进行中的回合无法继续：标为失败，可重试（演示"中断 → 重试"）
        S.runs.forEach((r) => { if (r.status === 'queued' || r.status === 'running') { r.status = 'failed'; r.error = 'Interrupted: the page was reloaded during the run. Nothing partial was written.'; } });
        return;
      }
    } catch (e) { /* 存储不可用时退回内存 */ }
    S = F.initialState();
  }
  function save() { try { localStorage.setItem('sfm-ledger-proto', JSON.stringify(S)); } catch (e) {} }
  function changed() { save(); onChange(); }

  let seq = 100;
  const id = (p) => p + (++seq) + Math.floor(Math.random() * 90 + 10);
  function ev(actor, type, aud, text) { S.events.push({ id: id('e'), at: Date.now(), actor, type, aud, text }); }
  function evText(e, role) { return typeof e.text === 'string' ? e.text : (e.text[role] || e.text._ || ''); }
  function visibleEvents(role) { return S.events.filter((e) => e.aud === 'room' || e.aud === role).slice().reverse(); }

  // ---------- 派生 ----------
  const latest = () => S.proposals[S.proposals.length - 1] || null;
  const getP = (v) => S.proposals.find((p) => p.v === v);
  function evalP(p) { return F.checkTerms(S, p, F.curC(S)); }
  function pStatus(p) {
    if (S.execution && S.execution.pv === p.v) return 'executed';
    if (S.execution) return 'superseded';
    if (latest() !== p) return 'superseded';
    if (!F.allPass(evalP(p))) return 'blocked';
    if (F.ROLE_KEYS.some((r) => decision(r, p) === 'rejected')) return 'rejected';
    return 'awaiting';
  }
  function lastDecision(role, p) {
    const ds = S.decisions.filter((d) => d.role === role && d.pv === p.v);
    return ds[ds.length - 1] || null;
  }
  // 审批状态：绑定 (提案版本, 约束版本)。约束变了 → stale，不删除。
  function decision(role, p) {
    const d = lastDecision(role, p);
    if (!d || d.kind === 'withdraw') return 'pending';
    if (d.cv !== F.curC(S).v && !(S.execution && S.execution.pv === p.v)) return 'stale';
    return d.kind === 'approve' ? 'approved' : 'rejected';
  }
  const activeRun = () => S.runs.find((r) => r.status === 'queued' || r.status === 'running') || null;
  const openRequest = () => S.requests.find((q) => q.status === 'open') || null;

  // 公共摘要用模板生成（不让模型写金额）
  function summary(o) {
    const inc = o.scope.map((k) => F.SCOPE[k].label).join(', ');
    const def = F.SCOPE_ORDER.filter((k) => !o.scope.includes(k));
    return o.label + ': ' + inc + ' by ' + F.fmtDate(o.date) + '.' + (def.length ? ' Deferred: ' + def.map((k) => F.SCOPE[k].label).join(', ') + '.' : '');
  }
  function makeProposal(offerId, runId, recs) {
    const o = F.OFFERS[offerId];
    const p = { v: S.proposals.length + 1, offerId, scope: o.scope.slice(), deferred: F.SCOPE_ORDER.filter((k) => !o.scope.includes(k)),
      cents: o.cents, date: o.date, createdUnderC: F.curC(S).v, runId, recs, summary: summary(o), at: Date.now() };
    S.proposals.push(p);
    return p;
  }

  // ---------- 代理回合 ----------
  const ALL_ACCEPT = { customer: 'recommend_accept', provider: 'recommend_accept', finance: 'recommend_accept' };
  function feasibleOffers() {
    const tried = S.proposals.map((p) => p.offerId);
    return Object.keys(F.OFFERS).filter((k) => !tried.includes(k) && F.allPass(F.checkTerms(S, Object.assign({ offerId: k }, F.OFFERS[k]), F.curC(S))));
  }
  function plan(purpose, extra) {
    // 初始协商：若"一期"在当前约束下也不可行（例如上限在回合中途被下调后重启），转入重新协商分支
    if (purpose === 'negotiate' && !F.allPass(F.checkTerms(S, Object.assign({ offerId: 'off-p1' }, F.OFFERS['off-p1']), F.curC(S)))) {
      const re = plan('renegotiate');
      return { steps: [
        { who: 'provider', t: 'Proposed "Full change request" ($1,400, Dec 4) from confirmed offer off-full v1.' },
        { who: 'rules', t: { provider: 'Rule check failed: exceeds finance limit; misses a customer private deadline.', _: 'Rule check failed: over the cap; misses a customer deadline.' } },
        { who: 'provider', t: 'Proposed "Phase 1" ($900, Nov 20) from confirmed offer off-p1 v1.' },
        { who: 'rules', t: { provider: 'Rule check failed: exceeds finance limit.', _: 'Rule check failed: over the cap by ' + F.money(90000 - F.headroom(S)) + '.' } }
      ].concat(re.steps), apply(run) {
        makeProposal('off-full', run.id, { customer: 'counter', provider: 'propose', finance: 'reject' });
        makeProposal('off-p1', run.id, { customer: 'recommend_accept', provider: 'propose', finance: 'reject' });
        re.apply(run);
      } };
    }
    if (purpose === 'negotiate') return {
      steps: [
        { who: 'provider', t: 'Proposed "Full change request" ($1,400, Dec 4) from confirmed offer off-full v1.' },
        { who: 'rules', t: { provider: 'Rule check failed: exceeds finance limit; misses a customer private deadline.', customer: 'Rule check failed: over the cap by $400; misses your hard deadline.', finance: 'Rule check failed: over the cap by $400; misses a customer private deadline.' } },
        { who: 'customer', t: 'Countered: keep required modules, defer Slack alerts to a later phase.' },
        { who: 'provider', t: 'Proposed "Phase 1" ($900, Nov 20) from confirmed offer off-p1 v1.' },
        { who: 'rules', t: 'Rule check passed: 5 of 5 checks.' },
        { who: 'all', t: 'All three agents recommend accepting v2. Only people can approve.' }
      ],
      apply(run) {
        makeProposal('off-full', run.id, { customer: 'counter', provider: 'propose', finance: 'reject' });
        const p = makeProposal('off-p1', run.id, ALL_ACCEPT);
        ev('system', 'proposal_created', 'room', 'Agent run #' + run.n + ' produced v1 (blocked by rules) and v2 (ready for approval). Agent recommendations are not approvals.');
        return p;
      } };
    if (purpose === 'renegotiate') {
      const f = feasibleOffers();
      const steps = [{ who: 'rules', t: { provider: 'Feasibility precheck: ' + f.length + ' confirmed offer(s) fit the finance limit and cover required scope.', _: 'Feasibility precheck: ' + f.length + ' confirmed offer(s) fit the remaining ' + F.money(F.headroom(S)) + ' and cover required scope.' } }];
      if (f.length >= 2) steps.push(
        { who: 'provider', t: 'Available: ' + f.map((k) => '"' + F.OFFERS[k].label + '" (' + F.money(F.OFFERS[k].cents) + ', ' + F.fmtDate(F.OFFERS[k].date) + ')').join(' and ') + '.' },
        { who: 'customer', t: 'Each option gives up a different customer preference. The agent will not choose for the customer.' },
        { who: 'system', t: 'Escalated: tradeoff request sent to Customer.' });
      else if (f.length === 1) steps.push({ who: 'provider', t: 'Proposed "' + F.OFFERS[f[0]].label + '" from confirmed offer ' + f[0] + ' v1.' }, { who: 'rules', t: 'Rule check passed: 5 of 5 checks.' });
      else steps.push({ who: 'system', t: { _: 'No confirmed offer fits. Escalated: request sent to Finance.' } });
      return { steps, apply(run) {
        if (f.length >= 2) {
          S.requests.push({ id: id('hr'), target: 'customer', cv: F.curC(S).v, status: 'open', at: Date.now(), runId: run.id,
            question: 'The budget change rules out v2. Two confirmed options fit. Which tradeoff do you prefer?',
            options: f.map((k) => ({ kind: 'offer', offerId: k })) });
          ev('system', 'human_request_opened', 'room', { customer: 'Your decision is needed: choose between ' + f.length + ' options.', _: 'Tradeoff request sent to Customer. Waiting on their choice.' });
        } else if (f.length === 1) {
          makeProposal(f[0], run.id, ALL_ACCEPT);
          ev('system', 'proposal_created', 'room', 'Agent run #' + run.n + ' produced v' + S.proposals.length + '.');
        } else {
          const minCap = F.committed(S) + 70000;
          S.requests.push({ id: id('hr'), target: 'finance', cv: F.curC(S).v, status: 'open', at: Date.now(), runId: run.id,
            question: 'No confirmed offer fits the current cap while covering required scope.', options: [{ kind: 'raise_cap', capCents: minCap }] });
          ev('system', 'human_request_opened', 'room', { finance: 'Your decision is needed: raise the cap to at least ' + F.money(minCap) + ' or keep it.', _: 'Request sent to Finance. Waiting on their decision.' });
        }
      } };
    }
    // draft：按人的选择起草新版本
    const o = F.OFFERS[extra.offerId];
    return { steps: [
      { who: 'provider', t: 'Drafted "' + o.label + '" (' + F.money(o.cents) + ', ' + F.fmtDate(o.date) + ') from confirmed offer ' + o.id + ' v1, per Customer\'s choice.' },
      { who: 'rules', t: 'Rule check passed: 5 of 5 checks.' },
      { who: 'all', t: 'All three agents recommend accepting. Only people can approve.' }
    ], apply(run) {
      const p = makeProposal(extra.offerId, run.id, ALL_ACCEPT);
      ev('system', 'proposal_created', 'room', 'Agent run #' + run.n + ' produced v' + p.v + ' under constraints v' + F.curC(S).v + '.');
    } };
  }

  function startRun(purpose, extra, attempt) {
    const pl = plan(purpose, extra);
    const run = { id: id('run'), n: S.runs.length + 1, purpose, extra: extra || null, status: 'queued', steps: [], total: pl.steps.length,
      attempt: attempt || 1, startedUnderC: F.curC(S).v, error: null, at: Date.now() };
    S.runs.push(run);
    ev('system', 'run_started', 'room', 'Agent run #' + run.n + ' started (' + purpose + ', constraints v' + run.startedUnderC + ').');
    const fail = S.failNextRun; S.failNextRun = false;
    const T = timers[run.id] = [];
    T.push(setTimeout(() => { run.status = 'running'; changed(); }, 500));
    pl.steps.forEach((st, i) => T.push(setTimeout(() => {
      if (fail && i === 2) {
        run.status = 'failed';
        run.error = 'Provider agent returned output that failed schema validation (2 of 2 attempts). Nothing was written.';
        ev('system', 'run_failed', 'room', 'Agent run #' + run.n + ' failed. No proposal was created. Anyone in the room can retry.');
        T.forEach(clearTimeout); changed(); return;
      }
      run.steps.push(st); changed();
    }, 1100 + i * 750)));
    T.push(setTimeout(() => {
      if (run.status !== 'running') return;
      // 结果写入前复核约束版本：过期结果丢弃
      if (run.startedUnderC !== F.curC(S).v) { run.status = 'discarded'; changed(); return; }
      pl.apply(run);
      run.status = 'completed';
      ev('system', 'run_completed', 'room', 'Agent run #' + run.n + ' completed.');
      changed();
    }, 1100 + pl.steps.length * 750 + 300));
    changed();
  }
  function retryRun(runId) {
    const r = S.runs.find((x) => x.id === runId);
    if (!r || r.status !== 'failed' || activeRun()) return;
    r.retried = true;
    startRun(r.purpose, r.extra, r.attempt + 1);
  }

  load();
  window.ENG = {
    init(cb) { onChange = cb; },
    get S() { return S; }, changed, evText, visibleEvents, latest, getP, evalP, pStatus, decision, lastDecision, activeRun, openRequest,
    startRun, retryRun,
    _: { S, F, id, ev, timers }
  };
})();

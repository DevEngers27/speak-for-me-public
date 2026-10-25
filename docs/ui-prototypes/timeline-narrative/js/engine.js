// 引擎：状态、事件追加、确定性校验、审批绑定、派生状态。
// 这里模拟的是"服务端"的职责；真实系统中这些由 Convex mutation 完成，浏览器只拿到裁剪后的视图。
(function () {
  const S = {};
  SFM.S = S;

  // 模拟时钟：从 Oct 24 09:00 开始，每个事件推进若干分钟。
  function clock(step) {
    S.minute += step == null ? 2 : step;
    const h = 9 + Math.floor(S.minute / 60); const m = S.minute % 60;
    return 'Oct 24, ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  SFM.clock = clock;

  SFM.reset = function () {
    const keepRole = S.role || 'customer';
    const keepSpeed = S.speed || 1;
    Object.keys(S).forEach(function (k) { delete S[k]; });
    Object.assign(S, {
      role: keepRole, speed: keepSpeed, forceFail: false,
      stage: 'briefs', cv: 1, cap: SFM.BUDGET.cap, committed: SFM.BUDGET.committed,
      deadline: SFM.DEADLINE,
      briefs: { customer: { v: 1, at: 'Oct 23, 16:10' }, provider: { v: 1, at: 'Oct 23, 17:45' }, finance: { v: 0, at: null } },
      proposals: {}, current: null, decisions: [], runs: {}, runSeq: 0,
      tradeoff: null, exec: null, tasksDone: {}, events: [], seq: 0, minute: 0,
      refs: {}, expanded: {}, hl: null, filter: 'all', busy: false, flash: null
    });
    // 种子事件（标注 simulated）
    emit('room_created', { phase: 'briefs', actor: { type: 'human', role: 'customer' }, time: 'Oct 23, 15:58' });
    S.refs.brief_customer = emit('brief_confirmed', { phase: 'briefs', who: 'customer', v: 1, actor: { type: 'human', role: 'customer' }, time: 'Oct 23, 16:10' });
    S.refs.brief_provider = emit('brief_confirmed', { phase: 'briefs', who: 'provider', v: 1, actor: { type: 'human', role: 'provider' }, time: 'Oct 23, 17:45' });
  };

  // 只追加的事件流。vis: 'room' 或某个角色（私密事件只对本人可见）。
  function emit(kind, data) {
    const ev = Object.assign({ id: 'e' + (++S.seq), kind: kind, vis: 'room', causes: [], seeded: S.seq <= 3 }, data);
    if (!ev.time) ev.time = clock(data && data.step);
    S.events.push(ev);
    return ev.id;
  }
  SFM.emit = emit;
  SFM.ev = function (id) { return S.events.find(function (e) { return e.id === id; }); };

  // ---- 确定性校验（代码负责，不信任模型声明）----
  SFM.runChecks = function (p) {
    const total = S.committed + p.cents;
    const q = SFM.QUOTES[p.quote];
    return {
      cv: S.cv, cap: S.cap, committed: S.committed, deadline: S.deadline,
      results: [
        { rule: 'budget', pass: total <= S.cap, total: total, cents: p.cents, cap: S.cap, avail: S.cap - S.committed },
        { rule: 'scope', pass: ['M1', 'M2'].every(function (i) { return p.items.indexOf(i) >= 0; }) },
        { rule: 'deadline', pass: p.date <= S.deadline, date: p.date, deadline: S.deadline },
        { rule: 'source', pass: !!q && q.cents === p.cents && q.date === p.date, quote: p.quote }
      ]
    };
  };
  SFM.allPass = function (chk) { return chk.results.every(function (r) { return r.pass; }); };

  SFM.addProposal = function (v, quote, byRole, causes, note) {
    const q = SFM.QUOTES[quote];
    const p = {
      v: v, quote: quote, items: q.items.slice(), cents: q.cents, date: q.date, by: byRole,
      deferred: SFM.ALL_ITEMS.filter(function (i) { return q.items.indexOf(i) < 0; }),
      cv: S.cv, note: note || ''
    };
    S.proposals[v] = p;
    p.eventId = emit('proposal', { phase: S.phaseNow, v: v, actor: { type: 'agent', role: byRole }, causes: causes || [] });
    return p;
  };

  SFM.checkProposal = function (v, causes) {
    const p = S.proposals[v];
    p.check = SFM.runChecks(p);
    p.checkEventId = emit('check', { phase: S.phaseNow, v: v, chk: p.check, actor: { type: 'code' }, causes: causes || [p.eventId], step: 1 });
    return p.check;
  };

  // ---- 审批：绑定 (提案版本, 约束版本)。条款或约束变了，旧审批失效但保留。----
  SFM.decisionFor = function (role, v) {
    const ds = S.decisions.filter(function (d) { return d.role === role && d.v === v; });
    if (!ds.length) return { state: 'pending' };
    const last = ds[ds.length - 1];
    if (last.cv !== S.cv) return { state: 'stale', d: last };
    return { state: last.decision, d: last };
  };

  SFM.proposalStatus = function (v) {
    const p = S.proposals[v];
    if (!p) return 'none';
    if (S.exec && S.exec.v === v) return 'executed';
    if (S.current !== v) return 'superseded';
    if (!p.check) return 'checking';
    if (p.cv !== S.cv) {
      // 约束变了：按当前约束重新校验
      const live = SFM.runChecks(p);
      if (!SFM.allPass(live)) return 'blocked';
    }
    if (!SFM.allPass(p.check)) return 'blocked';
    return 'ready';
  };

  // 当前约束下的实时校验（用于阻断解释）
  SFM.liveCheck = function (v) { return SFM.runChecks(S.proposals[v]); };

  SFM.approvalsComplete = function (v) {
    return SFM.ROLES.every(function (r) { return SFM.decisionFor(r, v).state === 'approved'; });
  };

  // 人的批准（与代理的 recommend_accept 完全分开存储）
  SFM.decide = function (role, decision) {
    const v = S.current; const p = S.proposals[v];
    if (!p || S.busy) return;
    if (SFM.proposalStatus(v) !== 'ready') { SFM.say('Approval is unavailable: proposal v' + v + ' is not executable.'); return; }
    const before = SFM.decisionFor(role, v).state;
    if (before === decision) return;
    const d = { role: role, v: v, cv: S.cv, decision: decision, time: clock(3) };
    S.decisions.push(d);
    const recId = S.refs['rec_' + v];
    d.eventId = emit('decision', {
      phase: S.stage === 'approval2' ? 'final' : 'approval', who: role, v: v, cv: S.cv, decision: decision,
      actor: { type: 'human', role: role }, time: d.time, causes: [p.checkEventId].concat(recId ? [recId] : [])
    });
    S.refs['dec_' + role + '_' + v] = d.eventId;
    SFM.say(SFM.PEOPLE[role].short + (decision === 'approved' ? ' approved' : ' rejected') + ' proposal v' + v + ' under constraints v' + S.cv + '.');
    if (decision === 'approved' && SFM.approvalsComplete(v)) SFM.execute(v);
    SFM.render();
  };

  // 原子、幂等执行：同一 operationId 只写一次。
  SFM.execute = function (v) {
    const p = S.proposals[v];
    const op = 'op_' + (v * 7919 + S.cv * 131).toString(16) + '_v' + v + 'c' + S.cv;
    if (S.exec && S.exec.op === op) return;
    const decIds = SFM.ROLES.map(function (r) { return S.refs['dec_' + r + '_' + v]; });
    S.exec = {
      v: v, cv: S.cv, op: op, co: 'CO-0042', cents: p.cents, items: p.items, deferred: p.deferred, date: p.date,
      totalAfter: S.committed + p.cents, cap: S.cap, quote: p.quote, time: clock(1),
      tasks: [
        { id: 't1', text: 'Kick-off call for change order CO-0042', role: 'provider', due: '2026-10-27' },
        { id: 't2', text: 'Deliver ' + SFM.itemList(p.items), role: 'provider', due: p.date },
        { id: 't3', text: 'Acceptance test of the first delivery', role: 'customer', due: p.date },
        { id: 't4', text: 'Record the ' + SFM.money(p.cents) + ' commitment in the Q4 budget report', role: 'finance', due: '2026-10-31' }
      ]
    };
    S.stage = 'executed';
    S.refs.exec = emit('execution', { phase: 'execution', v: v, cv: S.cv, actor: { type: 'system' }, causes: decIds, time: S.exec.time });
    S.committed += p.cents;
  };

  SFM.duplicateExecute = function () {
    if (!S.exec) return;
    emit('duplicate_ignored', { phase: 'execution', actor: { type: 'system' }, op: S.exec.op, causes: [S.refs.exec] });
    SFM.say('Duplicate execution request ignored. Same operation id, no new records.');
    SFM.render();
  };

  SFM.toggleTask = function (id) {
    const t = S.exec && S.exec.tasks.find(function (x) { return x.id === id; });
    if (!t || t.role !== S.role) return;
    S.tasksDone[id] = !S.tasksDone[id];
    emit('task', { phase: 'execution', task: id, done: S.tasksDone[id], actor: { type: 'human', role: S.role }, causes: [S.refs.exec], step: 1 });
    SFM.render();
  };

  // 因果追溯：从某个事件沿 causes 向上收集祖先。
  SFM.ancestors = function (id) {
    const seen = {}; const stack = [id];
    while (stack.length) {
      const cur = stack.pop(); if (!cur || seen[cur]) continue; seen[cur] = true;
      const e = SFM.ev(cur); if (e) e.causes.forEach(function (c) { stack.push(c); });
    }
    return seen;
  };
  SFM.children = function (id) {
    return S.events.filter(function (e) { return e.causes.indexOf(id) >= 0; });
  };

  SFM.say = function (msg) {
    S.flash = msg;
    const live = document.getElementById('live'); if (live) live.textContent = msg;
  };

  SFM.sleep = function (ms) {
    const f = S.speed === 0 ? 0 : ms / S.speed;
    return new Promise(function (res) { setTimeout(res, f); });
  };
})();

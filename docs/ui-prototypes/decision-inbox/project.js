// 按角色投影（模拟服务端 per-viewer query）。
// 界面只读这里返回的视图模型：他方私密字段不进入视图模型，而不是"拿到后再隐藏"。
// 原型限制：所有假数据仍在同一个 JS 里；真实系统中这一层在服务端执行，浏览器拿不到私密原文。
(function () {
  const D = window.SFM_DATA;
  const S = window.SFM;
  const money = S.money;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = iso => { const [y, m, d] = iso.split('-'); return MON[+m - 1] + ' ' + (+d); };
  const time = at => { const t = 9 * 60 + at; const h = Math.floor(t / 60), m = ((t % 60) + 60) % 60; return 'Oct 24, ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
  const label = r => D.people[r].label;

  function checksFor(st, offer, role) {
    const c = S.checkOffer(offer);
    const out = [];
    if (role === 'finance') {
      out.push({ ok: c.budget.ok, code: c.budget.ok ? 'budget.within_cap' : 'budget.over_cap',
        text: c.budget.ok ? `Total after commit ${money(c.budget.total)} ≤ cap ${money(c.budget.cap)}` : `Total after commit ${money(c.budget.total)} is ${money(c.budget.total - c.budget.cap)} over the ${money(c.budget.cap)} cap` });
    } else {
      out.push({ ok: c.budget.ok, code: c.budget.ok ? 'budget.within_cap' : 'budget.over_cap',
        text: c.budget.ok ? 'Fits Finance’s budget cap' : 'Over Finance’s budget cap', note: 'Budget amounts are private to Finance.' });
    }
    out.push({ ok: c.scope.ok, code: c.scope.ok ? 'scope.required_covered' : 'scope.required_missing', text: 'Required modules covered (SSO sign-in, invoice export)' });
    if (role === 'customer') {
      out.push({ ok: c.date.ok, code: c.date.ok ? 'date.meets_required' : 'date.missed', text: `${c.date.ok ? 'Meets' : 'Misses'} your required date (${fmtDate(st.deadline)})` });
    } else {
      out.push({ ok: c.date.ok, code: c.date.ok ? 'date.meets_required' : 'date.missed', text: c.date.ok ? 'Meets participants’ private date requirements' : 'Misses a participant’s private date requirement', note: 'The date itself is private to that participant.' });
    }
    out.push({ ok: c.source.ok, code: 'source.confirmed_offer', text: `Terms match Provider’s confirmed offer ${offer}` });
    return out;
  }

  function proposalView(st, p, role) {
    const o = D.offers[p.offer];
    const c = S.checkOffer(p.offer);
    return {
      v: p.v, offer: p.offer, label: o.label, cvAt: p.cvAt,
      scope: o.scope.map(m => D.modules[m]), deferred: o.deferred.map(m => D.modules[m]),
      cents: o.cents, price: money(o.cents), delivery: fmtDate(o.delivery),
      status: S.proposalStatus(p), checks: checksFor(st, p.offer, role),
      totalAfter: role === 'finance' ? money(c.budget.total) : null,
      approvals: D.roles.map(r => ({ role: r, name: D.people[r].name, human: S.approvalState(p.v, r),
        agent: st.recs.some(x => x.v === p.v && x.role === r && x.cv === st.cv) ? 'accept' : null })),
      myApproval: S.approvalState(p.v, role),
      myAgentRec: st.recs.some(x => x.v === p.v && x.role === role && x.cv === st.cv)
    };
  }

  function stageLabel(st) {
    const last = st.runs[st.runs.length - 1];
    if (last && last.status === 'failed') return { text: 'Agent run failed', tone: 'bad' };
    return ({
      brief: { text: 'Collecting briefs', tone: 'neutral' }, negotiating: { text: 'Agents negotiating', tone: 'busy' },
      approval_v2: { text: 'Awaiting approvals', tone: 'info' }, renegotiating: { text: 'Renegotiating', tone: 'busy' },
      tradeoff: { text: 'Needs a decision', tone: 'warn' }, formalizing: { text: 'Agents drafting', tone: 'busy' },
      approval_v3: { text: 'Awaiting approvals', tone: 'info' }, executed: { text: 'Executed', tone: 'ok' }
    })[st.stage];
  }

  function inbox(st, role, latestView, lastRun) {
    const needs = [], waiting = [], working = [], resolved = [];
    if (st.stage === 'brief') {
      if (role === 'finance') needs.push({ kind: 'confirm', title: 'Confirm your private brief', sub: 'Your agent extracted 5 items from your pasted text. Nothing is used until you confirm.', blocks: 'Negotiation can’t start until you confirm.', href: '#/decide/brief', cta: 'Review brief' });
      else waiting.push({ title: 'Finance is confirming their private brief', sub: 'You’ll see only which rules they choose to share.' });
    }
    if (latestView && latestView.status === 'ready' && /approval/.test(st.stage)) {
      const lv = latestView;
      if (lv.myApproval !== 'approved') needs.push({ kind: 'approve', title: `Approve proposal v${lv.v}`, sub: `${lv.label} · ${lv.price} · delivery ${lv.delivery}`, meta: `Under constraints v${st.cv}`, agent: lv.myAgentRec, blocks: 'Execution waits for all three approvals.', href: '#/decide/approve', cta: `Review v${lv.v}` });
      const others = lv.approvals.filter(a => a.role !== role && a.human !== 'approved').map(a => label(a.role));
      if (others.length) waiting.push({ title: `Waiting on ${others.join(' and ')} to approve v${lv.v}`, sub: lv.myApproval === 'approved' ? 'Your approval is recorded.' : '' });
    }
    if (st.request && st.request.status === 'open') {
      if (role === st.request.target) needs.push({ kind: 'choose', title: 'Choose: on time, or all modules?', sub: 'The budget went down. Two confirmed options fit; only you can decide which matters more.', blocks: 'A new proposal can’t be drafted until you answer.', href: '#/decide/tradeoff', cta: 'Make the choice' });
      else waiting.push({ title: 'Customer is choosing between two options', sub: 'On time with one module fewer, or all modules one week later.' });
    }
    if (lastRun && lastRun.status === 'running') working.push({ title: lastRun.purpose, sub: (lastRun.steps.find(s => s.state === 'active') || {}).text || 'Starting…', id: lastRun.id });
    if (lastRun && lastRun.status === 'failed') needs.push({ kind: 'retry', title: 'An agent run failed', sub: lastRun.error, blocks: 'Nothing was changed. Any participant can retry.', href: '#/room', cta: 'See run & retry' });
    // 已解决 / 不再需要
    st.decisions.filter(d => d.role === role).forEach(d => {
      const stale = d.cv !== st.cv && !(st.execution && st.execution.v === d.v);
      resolved.push({ title: `You approved v${d.v} under constraints v${d.cv}`, tag: stale ? 'No longer applies' : (st.execution && st.execution.v === d.v ? 'Used for execution' : 'Recorded'), tone: stale ? 'warn' : 'ok', at: d.at });
    });
    const v2 = st.proposals.find(p => p.v === 2);
    if (v2 && S.proposalStatus(v2) === 'blocked' && st.cv > 1 && !st.decisions.some(d => d.v === 2 && d.role === role))
      resolved.push({ title: 'Approval request for v2 withdrawn — v2 is blocked under the new constraints', tag: 'Withdrawn', tone: 'warn', at: st.events.filter(e => e.type === 'proposal_blocked').map(e => e.at)[0] || 0 });
    if (role === 'finance' && st.briefV.finance > 0) resolved.push({ title: 'You confirmed private brief v1', tag: 'Recorded', tone: 'ok', at: 0 });
    if (st.request && st.request.status === 'answered' && role === 'customer') resolved.push({ title: `You chose: ${st.request.answer.offer === 'OF-4' ? 'all modules, one week later' : 'on time, one module fewer'}`, tag: 'Answered', tone: 'ok', at: st.request.answeredAt });
    if (st.execution) resolved.push({ title: `Change order ${st.execution.co} recorded`, tag: 'Executed', tone: 'ok', at: st.execution.at, href: '#/room/results' });
    resolved.sort((a, b) => b.at - a.at);
    return { needs, waiting, working, resolved };
  }

  function sharedFacts(st, role) {
    const out = [];
    ['customer', 'provider'].forEach(r => { if (r !== role) D.briefs[r].items.filter(i => i.shared).forEach(i => out.push({ from: r, text: i.text, kind: i.kind })); });
    if (role !== 'finance' && st.briefV.finance > 0) {
      st.financeItems.forEach((it, idx) => { if (it.shared && it.status === 'confirmed') out.push({ from: 'finance', text: D.briefs.finance.items[idx].text, kind: D.briefs.finance.items[idx].kind }); });
    }
    return out;
  }

  function myBrief(st, role) {
    if (role === 'finance') {
      return { goal: D.briefs.finance.goal, v: st.briefV.finance, pasted: D.briefs.finance.pasted,
        items: D.briefs.finance.items.map((i, idx) => {
          let text = i.text;
          if (i.key === 'cap' && st.cap !== 500000) text = `Budget cap for this engagement: ${money(st.cap)} (was $5,000).`;
          if (i.key === 'committed' && st.committed !== 400000) text = `Already committed: ${money(st.committed)} (incl. ${st.execution.co}).`;
          return Object.assign({}, i, { text, status: st.financeItems[idx].status, shared: st.financeItems[idx].shared });
        }) };
    }
    const b = D.briefs[role];
    const items = b.items.map(i => Object.assign({}, i));
    if (role === 'customer' && st.deadline !== '2026-11-20') items[2].text = 'Required first delivery date: Nov 27, 2026 (moved from Nov 20 with your sign-off).';
    return { goal: b.goal, v: st.briefV[role], items, offerNote: b.offerNote,
      offers: role === 'provider' ? Object.keys(D.offers).map(k => Object.assign({ key: k, price: money(D.offers[k].cents), date: fmtDate(D.offers[k].delivery), scopeN: D.offers[k].scope.map(m => D.modules[m]) }, D.offers[k])) : null };
  }

  function requestView(st, role) {
    const rq = st.request; if (!rq) return null;
    const opts = rq.options.map(k => { const o = D.offers[k]; return { offer: k, label: o.label, scope: o.scope.map(m => D.modules[m]), deferred: o.deferred.map(m => D.modules[m]), price: money(o.cents), delivery: fmtDate(o.delivery) }; });
    const v = { id: rq.id, target: rq.target, status: rq.status, cv: rq.cv, options: opts, answer: rq.answer || null, mine: role === rq.target };
    if (v.mine) {
      // 只有目标人看到与其私密简报相关的提示
      opts[0].title = 'On time, one module fewer'; opts[0].impact = 'Meets your Nov 20 date. Audit log moves to phase 2 — it won’t be ready for the December SOC 2 review.';
      opts[1].title = 'All modules, one week later'; opts[1].impact = 'Includes the audit log. Delivery slips 7 days, which your own rule allows only with your sign-off — choosing this records it.';
      v.agentNote = 'Your agent leans toward “all modules” because your brief says the audit log matters for the SOC 2 review. It cannot choose for you: this trades your date against your scope.';
    } else {
      opts[0].title = 'On time, one module fewer'; opts[1].title = 'All modules, one week later';
    }
    return v;
  }

  window.SFMProject = function (st, role) {
    const lastRun = st.runs[st.runs.length - 1] || null;
    const proposals = st.proposals.map(p => proposalView(st, p, role));
    const latestView = proposals[proposals.length - 1] || null;
    const events = st.events.filter(e => (e.vis === 'all' && e.hideFor !== role) || e.vis === role)
      .map(e => Object.assign({}, e, { private: e.vis === role, time: time(e.at) })).sort((a, b) => b.at - a.at);
    const ex = st.execution;
    const exView = ex && (() => { const o = D.offers[ex.offer]; return {
      co: ex.co, op: ex.op, v: ex.v, cv: ex.cv, price: money(ex.cents), delivery: fmtDate(o.delivery), time: time(ex.at),
      scope: o.scope.map(m => D.modules[m]), deferred: o.deferred.map(m => D.modules[m]),
      budget: role === 'finance' ? { cap: money(ex.cap), before: money(ex.before), after: money(ex.after), left: money(ex.cap - ex.after) } : null,
      tasks: ex.tasks.map(t => Object.assign({}, t, { due: fmtDate(t.due), done: !!st.tasksDone[t.id], mine: t.assignee === role, who: D.people[t.assignee].name }))
    }; })();
    return {
      role, me: D.people[role], people: D.people, room: D.room, stage: st.stage, cv: st.cv, stageLabel: stageLabel(st),
      proposals, latest: latestView, lastRun, runs: st.runs, failNext: st.failNext,
      inbox: inbox(st, role, latestView, lastRun), events, sharedFacts: sharedFacts(st, role), brief: myBrief(st, role),
      briefStatus: D.roles.map(r => ({ role: r, v: st.briefV[r] })),
      budget: role === 'finance' ? { cap: money(st.cap), capC: st.cap, committed: money(st.committed), committedC: st.committed, remaining: money(st.cap - st.committed) } : null,
      decisions: st.decisions.map(d => ({ role: d.role, name: D.people[d.role].name, v: d.v, cv: d.cv, time: time(d.at),
        tag: st.execution && st.execution.v === d.v && st.execution.cv === d.cv ? 'Used for execution' : d.cv === st.cv ? 'Current' : 'No longer applies' })).reverse(),
      request: requestView(st, role), execution: exView, transcript: D.transcript, time, fmtDate, money
    };
  };
})();

/* engine-actions.js — 人的动作（简报确认、审批、预算下调、取舍回答）与原子幂等执行。
 * 依赖 engine.js 导出的内部工具。状态对象 S 在整个会话里是同一个对象（reset 原地替换内容）。 */
(function () {
  const E = window.ENG, F = window.SFM;
  const { S, id, ev, timers } = E._;
  const { changed, latest, getP, evalP, decision, activeRun, startRun } = E;
  // ---------- 人的动作 ----------
  function toggleShare(itemId) {
    const b = S.briefs[S.role]; if (b.status !== 'draft') return;
    const it = b.items.find((x) => x.id === itemId); it.share = !it.share; changed();
  }
  function confirmBrief() {
    const b = S.briefs[S.role]; if (b.status !== 'draft') return;
    b.status = 'confirmed'; b.v = 1; b.confirmedAt = Date.now();
    const shared = b.items.filter((i) => i.share).length;
    ev(S.role, 'brief_confirmed', 'room', { [S.role]: 'You confirmed brief v1 (' + shared + ' of ' + b.items.length + ' items shared with the room).', _: F.ROLES[S.role].label + ' confirmed brief v1.' });
    if (F.ROLE_KEYS.every((r) => S.briefs[r].status === 'confirmed') && !S.proposals.length) startRun('negotiate');
    else changed();
  }
  function decide(kind, pv) {
    const role = S.role, p = getP(pv);
    if (!p || p !== latest() || S.execution) return;
    const st = decision(role, p);
    if (kind === 'approve' && (st === 'approved' || !F.allPass(evalP(p)))) return;
    if (kind === 'withdraw' && st !== 'approved' && st !== 'rejected') return;
    const cv = F.curC(S).v;
    S.decisions.push({ id: id('d'), role, pv, cv, kind, at: Date.now() });
    const verb = { approve: 'approved', reject: 'rejected', withdraw: 'withdrew their decision on' }[kind];
    ev(role, 'decision_recorded', 'room', { [role]: 'You ' + verb.replace('their', 'your') + ' v' + pv + ' under constraints v' + cv + '.', _: F.ROLES[role].label + ' ' + verb + ' v' + pv + ' under constraints v' + cv + '.' });
    if (kind === 'approve') tryExecute(p); else changed();
  }
  function changeCap(newCap, reason) {
    if (S.role !== 'finance') return 'Only Finance can change the budget cap.';
    const c = F.curC(S);
    if (!(newCap >= F.committed(S))) return 'The cap cannot be lower than what is already committed (' + F.money(F.committed(S)) + ').';
    if (newCap === c.capCents) return 'The cap is already ' + F.money(newCap) + '.';
    if (S.execution) return 'This room is closed. Budget changes no longer affect it.';
    const nc = { v: c.v + 1, capCents: newCap, by: 'finance', at: Date.now(), reason: reason || 'Not specified' };
    S.constraints.push(nc);
    ev('finance', 'constraints_changed', 'room', {
      finance: 'You changed the cap ' + F.money(c.capCents) + ' → ' + F.money(newCap) + ' (constraints v' + c.v + ' → v' + nc.v + '). Reason: ' + nc.reason + '.',
      customer: 'Finance changed the cap ' + F.money(c.capCents) + ' → ' + F.money(newCap) + ' (constraints v' + c.v + ' → v' + nc.v + ').',
      provider: 'Finance changed budget constraints (v' + c.v + ' → v' + nc.v + '). Figures are private to Finance.' });
    const p = latest();
    const staleCount = p ? F.ROLE_KEYS.filter((r) => decision(r, p) === 'stale').length : 0;
    if (staleCount) ev('system', 'approvals_stale', 'room', staleCount + ' approval(s) on v' + p.v + ' no longer apply: they were given under constraints v' + c.v + '. Kept in history.');
    const ar = activeRun();
    if (ar) { (timers[ar.id] || []).forEach(clearTimeout); ar.status = 'discarded'; ev('system', 'run_discarded', 'room', 'Agent run #' + ar.n + ' was discarded: constraints changed while it ran.'); }
    S.requests.filter((q) => q.status === 'open').forEach((q) => { q.status = 'superseded'; });
    // 进行中的初始协商被丢弃 → 在新约束下重新开始
    if (ar && ar.purpose === 'negotiate') { ev('system', 'run_restarted', 'room', 'Restarting the negotiation under constraints v' + nc.v + '.'); startRun('negotiate'); return null; }
    if (p && !F.allPass(evalP(p))) {
      ev('system', 'proposal_blocked', 'room', { provider: 'v' + p.v + ' now exceeds the finance limit and cannot execute. Re-negotiation started.', _: 'v' + p.v + ' is now over the cap by ' + F.money(p.cents - F.headroom(S)) + ' and cannot execute. Re-negotiation started.' });
      startRun('renegotiate');
    } else changed(); // 当前提案仍可执行：条款不变，只需在新约束下重新审批
    return null;
  }
  function answer(reqId, idx) {
    const q = S.requests.find((x) => x.id === reqId);
    if (!q || q.status !== 'open' || q.target !== S.role) return;
    const o = q.options[idx];
    q.status = 'answered'; q.answer = { idx, at: Date.now(), by: S.role };
    if (o.kind === 'offer') {
      const off = F.OFFERS[o.offerId];
      ev(S.role, 'human_request_answered', 'room', { [S.role]: 'You chose "' + off.label + '".', _: 'Customer chose "' + off.label + '".' });
      startRun('draft', { offerId: o.offerId });
    } else if (o.kind === 'raise_cap') {
      ev(S.role, 'human_request_answered', 'room', { finance: 'You chose to raise the cap.', _: 'Finance answered the request.' });
      changeCap(o.capCents, 'Answer to request: restore minimum viable budget');
    }
  }
  function keepCap(reqId) {
    const q = S.requests.find((x) => x.id === reqId); if (!q || q.target !== S.role) return;
    q.status = 'answered'; q.answer = { idx: -1, at: Date.now(), by: S.role };
    ev(S.role, 'human_request_answered', 'room', { _: 'Finance kept the cap. No feasible option remains; the room stays blocked.' }); changed();
  }

  // ---------- 原子、幂等执行 ----------
  function tryExecute(p) {
    const cv = F.curC(S).v;
    const ready = F.ROLE_KEYS.every((r) => decision(r, p) === 'approved') && F.allPass(evalP(p));
    if (!ready) { changed(); return; }
    const opId = 'exec:rm-analytics:p' + p.v + ':c' + cv;
    if (S.execution) { if (S.execution.opId === opId) duplicate(); return; }
    const co = 'CO-2026-014', addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const tasks = p.scope.map((k, i) => ({ id: 'T-' + (i + 1), role: 'provider', text: 'Deliver ' + F.SCOPE[k].label, due: p.date, done: false }));
    tasks.push({ id: 'T-' + (tasks.length + 1), role: 'customer', text: 'User acceptance test and sign-off', due: addDays(p.date, 3), done: false });
    tasks.push({ id: 'T-' + (tasks.length + 1), role: 'finance', text: 'Schedule milestone invoice review', due: addDays(p.date, 5), done: false });
    const before = F.committed(S);
    S.ledger.push({ id: 'CMT-0002', cents: p.cents, label: 'Change order ' + co + ' (simulated)', at: Date.now(), source: opId });
    S.execution = { opId, pv: p.v, cv, at: Date.now(), changeOrder: co, cents: p.cents, before, after: before + p.cents, cap: F.curC(S).capCents, tasks };
    ev('system', 'execution_completed', 'room', {
      provider: 'Executed v' + p.v + ' under constraints v' + cv + ': change order ' + co + ' (' + F.money(p.cents) + '), ' + tasks.length + ' tasks. Internal records only.',
      _: 'Executed v' + p.v + ' under constraints v' + cv + ': change order ' + co + ', commitment CMT-0002 ' + F.money(p.cents) + ', ' + tasks.length + ' tasks. Internal records only.' });
    changed();
  }
  function duplicate() {
    if (!S.execution) return;
    S.dupAttempts++;
    ev('system', 'execution_duplicate_ignored', 'room', 'Duplicate execution request ignored: operation ' + S.execution.opId + ' already completed. No new records.');
    changed();
  }
  function toggleTask(tid) { const t = S.execution && S.execution.tasks.find((x) => x.id === tid); if (t && t.role === S.role) { t.done = !t.done; changed(); } }

  function reset() {
    Object.values(timers).forEach((T) => T.forEach(clearTimeout));
    const role = S.role, fresh = F.initialState();
    Object.keys(S).forEach((k) => delete S[k]);
    Object.assign(S, fresh, { role, route: 'rooms' });
    changed();
  }

  Object.assign(window.ENG, { toggleShare, confirmBrief, decide, changeCap, answer, keepCap, duplicate, toggleTask, reset });
})();

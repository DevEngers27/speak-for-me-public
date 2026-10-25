/* actions.js —— 动作（相当于 mutation，全有或全无）与代理回合模拟（相当于 action + scheduler）
 * 每个动作返回 {ok, msg}；msg 只给发起者看，可含发起者自己的私密值。
 */
var STEP_MS = 900;
function fail(msg) { return { ok: false, msg: msg }; }
function okr(msg) { return { ok: true, msg: msg }; }

function confirmBrief(role) {
  if (S.briefs[role].v) return fail('Brief already confirmed.');
  S.briefs[role] = { v: 1, at: now() };
  var acc = S.drafts.filter(function (d) { return d.state === 'accepted'; }).length;
  ev('brief_confirmed', 'private:' + role, role, { d: 'You confirmed brief v1' + (role === 'finance' ? ' (' + acc + ' extracted item(s) accepted; pending drafts excluded).' : '.') });
  ev('brief_confirmed', 'room', role, { d: ROLES[role].label + ' confirmed brief v1.' });
  if (ROLE_KEYS.every(function (r) { return S.briefs[r].v; })) startRun('initial', 'All three briefs confirmed');
  return okr('Brief v1 confirmed. Only you and your agent can see its private items.');
}
function resolveDraft(id, accept) {
  S.drafts.forEach(function (d) { if (d.id === id) d.state = accept ? 'accepted' : 'discarded'; });
  return okr(accept ? 'Extracted item accepted into your draft brief.' : 'Extracted item discarded.');
}

function approve(role) {
  var p = current();
  if (!p || p.v == null) return fail('No proposal to approve.');
  if (roomStatus() !== 'awaiting') return fail('Approval is not open right now.');
  if (!passes(p, S.cv)) return fail('v' + p.v + ' fails a check under constraints v' + S.cv + '.');
  if (decisionOf(role, p).state === 'approved') return fail('You already approved v' + p.v + ' under constraints v' + S.cv + '.');
  S.approvals.push({ role: role, pv: p.v, cv: S.cv, decision: 'approve', at: now() });
  ev('decision_recorded', 'room', role, { d: ROLES[role].label + ' approved proposal v' + p.v + ' under constraints v' + S.cv + '.' });
  var all = ROLE_KEYS.every(function (r) { return decisionOf(r, p).state === 'approved'; });
  if (all) { execute(p); return okr('Approved. All required approvals are in — executing v' + p.v + '.'); }
  return okr('Your approval of v' + p.v + ' under constraints v' + S.cv + ' is recorded.');
}
function reject(role, reason) {
  var p = current();
  if (!reason || !reason.trim()) return fail('A reason is required to reject.');
  if (roomStatus() !== 'awaiting') return fail('Rejection is not open right now.');
  S.approvals.push({ role: role, pv: p.v, cv: S.cv, decision: 'reject', reason: reason, at: now() });
  ev('decision_recorded', 'room', role, { d: ROLES[role].label + ' rejected proposal v' + p.v + ': “' + reason + '”' });
  startRun('renegotiation', ROLES[role].label + ' rejected v' + p.v);
  return okr('Rejection recorded with your reason. A renegotiation run has started.');
}

/* 原子、幂等执行：operationId 由 (房间, 提案版本, 约束版本) 决定，重复提交不产生重复记录 */
function execute(p) {
  var op = 'op_' + ROOM_ID + '_p' + p.v + '_c' + S.cv;
  if (S.execution && S.execution.op === op) return;
  S.execution = { pending: true, op: op };
  var finish = function () {
    var o = OFFERS[p.offer], due = p.date;
    S.execution = { co: 'CO-2026-014', op: op, pv: p.v, cv: S.cv, at: now(), amount: p.cost, scope: p.scope, deferred: p.deferred, date: p.date,
      before: COMMITTED, cap: capNow(), approvals: S.approvals.filter(function (a) { return a.pv === p.v && a.cv === S.cv && a.decision === 'approve'; }) };
    S.tasks = p.scope.map(function (s, i) { return { id: 't' + i, title: 'Build ' + CATALOG[s].name, role: 'provider', due: due, done: false }; })
      .concat([{ id: 'tu', title: 'UAT sign-off for phase 1', role: 'customer', due: due, done: false },
               { id: 'tm', title: 'Schedule milestone payments (' + money(p.cost) + ')', role: 'finance', due: due, done: false }]);
    ev('execution_completed', 'room', 'system', { d: 'Change order CO-2026-014 recorded for v' + p.v + ' (constraints v' + S.cv + '): commitment of ' + money(p.cost) + ' and ' + S.tasks.length + ' tasks created. Internal records only.' });
    ev('execution_completed', 'private:finance', 'system', { d: 'Budget commitment ' + money(p.cost) + ' recorded. Committed is now ' + money(COMMITTED + p.cost) + ' of ' + money(capNow()) + ' cap.' });
    S.opsLog = (S.opsLog || []).concat(['execute ' + op + ' → written once']);
    commit();
  };
  if (FAST) finish(); else setTimeout(finish, 1200);
}
function duplicateSubmit() {
  if (!S.execution || S.execution.pending) return fail('Nothing executed yet.');
  S.opsLog = (S.opsLog || []).concat(['execute ' + S.execution.op + ' → duplicate ignored']);
  return okr('Same operation ' + S.execution.op + ' already recorded. No duplicate change order, commitment or tasks.');
}
function toggleTask(role, id) {
  var t = S.tasks.filter(function (x) { return x.id === id; })[0];
  if (!t || t.role !== role) return fail('Only the assignee can update this task.');
  t.done = !t.done;
  ev('task_updated', 'room', role, { d: ROLES[role].label + (t.done ? ' completed task: ' : ' reopened task: ') + t.title });
  return okr('Task updated.');
}

/* 预算变更：约束版本 +1；旧审批不删除但失效；当前方案被重新校验；运行中的回合被作废 */
function setCap(newCap) {
  if (S.execution) return fail('This room is executed. Budget changes now start a new round (not in this prototype).');
  if (!(newCap >= COMMITTED)) return fail('Cap cannot be below already committed spend (' + money(COMMITTED) + ').');
  var old = capNow();
  if (newCap === old) return fail('Cap is unchanged.');
  var oldCv = S.cv; S.cv += 1;
  S.constraints.push({ v: S.cv, cap: newCap, at: now(), by: 'finance', note: 'Budget cap changed' });
  S.runs.forEach(function (r) { if (r.status === 'running') { r.status = 'discarded'; ev('run_discarded', 'room', 'system', { d: 'Run #' + r.id + ' was discarded: it was based on constraints v' + oldCv + '.' }); } });
  S.requests.forEach(function (r) { if (r.status === 'open') { r.status = 'cancelled'; } });
  ev('constraints_changed', 'private:finance', 'finance', { d: 'You changed the budget cap ' + money(old) + ' → ' + money(newCap) + ' (constraints v' + oldCv + ' → v' + S.cv + ').' });
  ev('constraints_changed', 'room', 'finance', { d: 'Finance updated a budget constraint (constraints v' + oldCv + ' → v' + S.cv + '). Approvals given under v' + oldCv + ' no longer count.' });
  var p = current();
  if (p && !passes(p, S.cv)) {
    var n = S.approvals.filter(function (a) { return a.pv === p.v && a.cv === oldCv && a.decision === 'approve'; }).length;
    ev('proposal_blocked', 'room', 'system', { d: 'Proposal v' + p.v + ' no longer passes the budget check and is blocked. ' + n + ' approval(s) kept in history as no longer applying.',
      finance: 'Proposal v' + p.v + ' is blocked: ' + money(COMMITTED) + ' + ' + money(p.cost) + ' = ' + money(COMMITTED + p.cost) + ' > new cap ' + money(newCap) + '. ' + n + ' approval(s) no longer apply.' });
    startRun('renegotiation', 'Budget constraint changed (v' + S.cv + ')');
  }
  return okr('Cap set to ' + money(newCap) + '. Constraints are now v' + S.cv + '.');
}

/* 人的取舍回答 → 代码按所选的已确认报价生成新提案版本 */
function answerRequest(role, optId, note) {
  var rq = openRequest();
  if (!rq || rq.target !== role) return fail('This request is not addressed to you.');
  var opt = rq.options.filter(function (o) { return o.id === optId; })[0];
  rq.status = 'answered'; rq.answer = { opt: optId, note: note, at: now() };
  ev('human_request_answered', 'room', role, { d: ROLES[role].label + ' answered ' + rq.id + ': ' + opt.title + '.' });
  if (note) ev('human_request_answered', 'private:' + role, role, { d: 'Your note on ' + rq.id + ' (shared with your agent only): “' + note + '”' });
  if (opt.kind === 'cap') { setCap(opt.cap); return okr('Answer recorded.'); }
  if (opt.kind === 'pause') { return okr('Answer recorded. The room stays paused until someone changes a constraint.'); }
  addProposal(opt.offer, 'Provider agent, from ' + role + ' decision ' + rq.id, rq.run);
  recommendAll(current(), 'Matches the decision on ' + rq.id + '.');
  return okr('Answer recorded. Proposal v' + current().v + ' was created from your choice and is ready for approvals.');
}

function addProposal(offerId, origin, runId) {
  var o = OFFERS[offerId], all = Object.keys(CATALOG);
  var p = { v: S.proposals.length + 1, offer: offerId, scope: o.scope.slice(), deferred: all.filter(function (i) { return o.scope.indexOf(i) < 0; }),
    cost: o.cost, date: o.date, cv: S.cv, origin: origin, run: runId, at: now() };
  S.proposals.push(p);
  var ok = passes(p, S.cv), fails = checks(p, S.cv).filter(function (c) { return !c.pass; }).map(function (c) { return c.label.toLowerCase(); });
  ev('proposal_recorded', 'room', 'provider', { d: 'Proposal v' + p.v + ' recorded: ' + o.label + ', ' + money(p.cost) + ', delivery ' + shortDate(p.date) + '. ' + (ok ? 'All checks pass.' : 'Fails: ' + fails.join(', ') + '.') });
  return p;
}
function recommendAll(p, why) {
  ROLE_KEYS.forEach(function (r) { S.recs.push({ pv: p.v, cv: S.cv, role: r, action: 'recommend_accept', text: why }); });
}

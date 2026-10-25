/* engine.js —— 确定性规则、派生状态与按查看者裁剪的投影（模拟服务端读模型）
 * 原则：状态尽量从数据派生，不手工赋值；检查由代码完成，不信任代理声明。
 */
var S = null;            // 全部状态（相当于数据库；渲染层不得直接读私密字段）
var FAST = false;        // 快进模式：跳关时同步执行代理回合
var STORE_KEY = 'sfm-proto-three-pane:v1';
var CLOCK = null;        // 快进时使用的假时钟，让跳关生成的事件有先后间隔
function now() { if (CLOCK !== null) { CLOCK += 40000; return CLOCK; } return Date.now(); }

function money(c) { return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 }); }
function dateStr(iso) { var d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function shortDate(iso) { var d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function timeStr(ms) { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }
function scopeNames(ids) { return ids.map(function (i) { return CATALOG[i].name; }).join(', '); }

function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} }
function load() {
  try { var raw = localStorage.getItem(STORE_KEY); if (raw) { S = JSON.parse(raw); } } catch (e) { S = null; }
  if (!S || !S.constraints) S = freshState();
  // 页面重载时，进行中的代理回合无法续跑：标记为中断失败，可重试（演示失败/重试状态）
  S.runs.forEach(function (r) {
    if (r.status === 'running') { r.status = 'failed'; r.error = 'interrupted'; r.turns.forEach(function (t) { if (t.status === 'running' || t.status === 'retrying') { t.status = 'failed'; t.err = 'Interrupted (page reload)'; } }); }
  });
  if (S.execution && S.execution.pending) S.execution = null;
}
function commit() { save(); if (window.render) window.render(); }

function ev(type, vis, actor, text) {
  S.events.push({ id: 'e' + (S.events.length + 1) + '_' + Date.now(), seq: S.events.length, at: now(), type: type, vis: vis, actor: actor, text: text });
}
function capAt(cv) { for (var i = 0; i < S.constraints.length; i++) if (S.constraints[i].v === cv) return S.constraints[i].cap; return null; }
function capNow() { return capAt(S.cv); }
function current() { return S.proposals.length ? S.proposals[S.proposals.length - 1] : null; }
function lastRun() { return S.runs.length ? S.runs[S.runs.length - 1] : null; }
function openRequest() { return S.requests.filter(function (r) { return r.status === 'open'; })[0] || null; }

/* 确定性检查：输入提案与约束版本，输出 reasonCode + 按角色裁剪的说明 */
function checks(p, cv) {
  var cap = capAt(cv), total = COMMITTED + p.cost, cb = BRIEFS.customer, o = OFFERS[p.offer];
  var missing = cb.required.filter(function (i) { return p.scope.indexOf(i) < 0; });
  var okDate = p.date <= cb.latest;
  var okSrc = o && o.cost === p.cost && o.date === p.date && o.scope.join() === p.scope.join();
  return [
    { code: total <= cap ? 'budget.within_cap' : 'budget.over_cap', label: 'Budget limit', pass: total <= cap, owner: 'finance',
      own: money(COMMITTED) + ' committed + ' + money(p.cost) + ' = ' + money(total) + (total <= cap ? ' ≤ ' : ' > ') + 'cap ' + money(cap) + ' (constraints v' + cv + ')',
      other: total <= cap ? 'Within Finance’s budget limit.' : 'Over Finance’s budget limit. Finance has not shared the amounts with you.' },
    { code: missing.length ? 'scope.required_missing' : 'scope.required_covered', label: 'Required scope', pass: !missing.length, owner: 'all',
      own: missing.length ? 'Missing required: ' + scopeNames(missing) : 'Covers required: ' + scopeNames(cb.required) },
    { code: okDate ? 'deadline.ok' : 'deadline.violated', label: 'Delivery limit', pass: okDate, owner: 'customer',
      own: 'Delivery ' + shortDate(p.date) + (okDate ? ' is on or before' : ' is after') + ' your latest date ' + shortDate(cb.latest) + '.',
      other: okDate ? 'Meets a private Customer delivery limit.' : 'Misses a private Customer delivery limit.' },
    { code: okSrc ? 'source.matches_quote' : 'source.unsourced', label: 'Source', pass: !!okSrc, owner: 'all',
      own: okSrc ? 'Price, scope and date match confirmed quote ' + o.id + ' v' + o.v + '.' : 'Terms do not match any confirmed quote.' }
  ];
}
function checksFor(p, cv, role) {
  return checks(p, cv).map(function (c) {
    var mine = c.owner === 'all' || c.owner === role;
    return { code: c.code, label: c.label, pass: c.pass, detail: mine ? c.own : c.other, privateTo: c.owner !== 'all' ? c.owner : null, mine: mine };
  });
}
function passes(p, cv) { return checks(p, cv).every(function (c) { return c.pass; }); }

function decisionOf(role, p) {
  var ds = S.approvals.filter(function (a) { return a.role === role && a.pv === p.v; });
  var d = ds[ds.length - 1];
  if (!d) return { state: 'pending' };
  if (d.decision === 'reject') return { state: 'rejected', d: d };
  if (d.cv !== S.cv) return { state: 'stale', d: d };
  return { state: 'approved', d: d };
}
function proposalStatus(p) {
  if (S.execution && !S.execution.pending && S.execution.pv === p.v) return 'executed';
  if (p !== current()) return passes(p, S.cv) ? 'superseded' : 'superseded-blocked';
  if (!passes(p, S.cv)) return 'blocked';
  if (ROLE_KEYS.some(function (r) { return decisionOf(r, p).state === 'rejected'; })) return 'rejected';
  return 'awaiting';
}
function roomStatus() {
  if (S.execution && S.execution.pending) return 'executing';
  if (S.execution) return 'executed';
  if (ROLE_KEYS.some(function (r) { return !S.briefs[r].v; })) return 'collecting';
  var run = lastRun();
  if (run && run.status === 'running') return 'negotiating';
  if (run && run.status === 'failed') return 'run_failed';
  if (openRequest()) return 'needs_input';
  var p = current();
  if (!p) return 'draft';
  var st = proposalStatus(p);
  if (st === 'blocked') return 'blocked';
  if (st === 'rejected') return 'needs_input';
  return 'awaiting';
}
var STATUS_LABEL = { collecting: 'Collecting briefs', negotiating: 'Agents negotiating', run_failed: 'Run failed', needs_input: 'Needs a decision', blocked: 'Blocked', awaiting: 'Awaiting approvals', executing: 'Executing', executed: 'Executed', draft: 'Draft' };
var STATUS_TONE = { collecting: 'muted', negotiating: 'info', run_failed: 'danger', needs_input: 'warn', blocked: 'danger', awaiting: 'info', executing: 'info', executed: 'ok', draft: 'muted' };

/* 每个角色的待办（真实系统由服务端 per-viewer 查询给出） */
function todosFor(role) {
  var out = [], st = roomStatus(), p = current(), rq = openRequest(), run = lastRun();
  if (!S.briefs[role].v) out.push({ text: 'Confirm your private brief so negotiation can start.', go: '#/room/brief', cta: 'Review brief' });
  if (rq && rq.target === role) out.push({ text: rq.title, go: '#/room', cta: 'Answer', anchor: 'request' });
  if (st === 'run_failed') out.push({ text: 'Negotiation run #' + run.id + ' failed. Anyone in the room can retry it.', go: '#/room', cta: 'Retry run', action: 'retry-run' });
  if (p && st === 'awaiting') {
    var d = decisionOf(role, p);
    if (d.state === 'pending') out.push({ text: 'Approve or reject proposal v' + p.v + ' under constraints v' + S.cv + '.', go: '#/room', cta: 'Review v' + p.v, anchor: 'proposal' });
    if (d.state === 'stale') out.push({ text: 'Your approval of v' + p.v + ' was given under constraints v' + d.d.cv + ' and no longer counts. Approve again under v' + S.cv + '.', go: '#/room', cta: 'Review', anchor: 'proposal' });
  }
  return out;
}
function waitingOn() {
  var st = roomStatus(), p = current(), rq = openRequest();
  if (st === 'collecting') return ROLE_KEYS.filter(function (r) { return !S.briefs[r].v; }).map(function (r) { return ROLES[r].label + ' (brief)'; });
  if (rq) return [ROLES[rq.target].label + ' (decision ' + rq.id + ')'];
  if (st === 'awaiting' && p) return ROLE_KEYS.filter(function (r) { return decisionOf(r, p).state !== 'approved'; }).map(function (r) { return ROLES[r].label + ' (approval)'; });
  if (st === 'negotiating') return ['Agents (run #' + lastRun().id + ')'];
  return [];
}

/* 事件投影：私密事件只给本人；文本按受众取版本 */
function eventsFor(role) {
  return S.events.filter(function (e) { return e.vis === 'room' || e.vis === 'private:' + role; })
    .map(function (e) { return { id: e.id, seq: e.seq, at: e.at, type: e.type, actor: e.actor, priv: e.vis !== 'room', text: e.text[role] || e.text.d }; })
    .sort(function (a, b) { return (b.at - a.at) || ((b.seq || 0) - (a.seq || 0)); });
}
function msgFor(m, role) { return m ? (m[role] || m.d) : ''; }

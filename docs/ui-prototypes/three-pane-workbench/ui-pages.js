/* ui-pages.js —— 房间列表、简报确认、执行结果、完整时间线 */
function roomsPage() {
  var st = roomStatus(), todos = todosFor(S.role), w = waitingOn(), p = current();
  var main = '<article class="panel roomcard"><div class="row between"><h2><a href="#/room">Clinic portal — scope change Q4</a></h2>' + chip(STATUS_LABEL[st], STATUS_TONE[st]) + '</div>' +
    '<div class="small muted">Customer · Provider · Finance · Simulated fixture</div>' +
    '<div class="row" style="margin:8px 0"><span class="vchip">Proposal ' + (p ? 'v' + p.v : '—') + '</span><span class="vchip">Constraints v' + S.cv + '</span>' +
    (S.role === 'finance' ? '<span class="small">Headroom ' + money(capNow() - COMMITTED) + '</span> ' + privTag('Finance only') : '') + '</div>' +
    (todos.length ? todos.map(function (t) { return '<div class="todo-badge" style="margin:2px 0">Needs you: ' + esc(t.text) + '</div>'; }).join('') : '<div class="small muted">Nothing needs you.' + (w.length ? ' Waiting on ' + esc(w.join(', ')) + '.' : '') + '</div>') +
    '<div class="actions"><a class="btn primary" href="#/room">Open workbench</a><a class="btn" href="#/room/brief">My brief</a></div></article>';
  var samples = SAMPLE_ROOMS.map(function (r) {
    var td = r.todo && r.todo[S.role];
    return '<article class="panel roomcard" style="opacity:.8"><div class="row between"><h2>' + esc(r.title) + '</h2>' + chip(r.statusLabel, r.status === 'executed' ? 'ok' : 'muted') + '</div><div class="small muted">' + esc(r.note) + '</div>' +
      (td ? '<div class="todo-badge" style="margin-top:6px">Needs you: ' + esc(td) + '</div>' : '') + '<div class="tiny muted" style="margin-top:8px">Static sample · not clickable in this prototype</div></article>';
  }).join('');
  return '<div class="page"><div class="row between" style="margin-bottom:12px"><div><h1 class="roomtitle">Rooms</h1><div class="small muted">Rooms you belong to as ' + ROLES[S.role].label + '. Each card shows what needs you first.</div></div>' +
    '<button class="btn" disabled title="Not in this prototype">New room</button></div><div class="rooms">' + main + samples + '</div></div>';
}

function briefPage() {
  var r = S.role, b = BRIEFS[r], st = S.briefs[r];
  var items = b.items.map(function (it) {
    return '<div class="bitem"><div class="row between"><span class="k">' + esc(it.kind) + (it.rule ? ' · checked by code (<span class="mono">' + it.rule + '</span>)' : '') + '</span>' +
      (it.vis === 'private' ? '<span class="privtag">Private · only you and your agent</span>' : '<span class="sharedtag">Shared with room</span>') + '</div><div>' + esc(it.text) + '</div></div>';
  }).join('');
  var drafts = '';
  if (r === 'finance') drafts = '<section class="panel" style="margin-top:14px"><div class="panel-h"><h2>Extracted from your pasted notes</h2>' + chip('Needs your confirmation', 'warn') + '</div>' +
    '<div class="small muted" style="margin-bottom:6px">Your agent turned pasted text into draft items. Nothing extracted is used until you accept it.</div>' +
    S.drafts.map(function (d) {
      return '<div class="bitem"><div class="row between"><span class="k">' + esc(d.kind) + '</span>' + chip(d.state === 'pending' ? 'Draft' : d.state === 'accepted' ? 'Accepted' : 'Discarded', d.state === 'accepted' ? 'ok' : d.state === 'pending' ? 'warn' : 'muted') + '</div>' +
        '<div>' + esc(d.text) + '</div><div class="tiny muted">Source: ' + esc(d.src) + '</div>' +
        (d.state === 'pending' && !st.v ? '<div class="row" style="margin-top:6px"><button class="btn sm" data-action="draft" data-id="' + d.id + '" data-acc="1">Accept</button><button class="btn sm" data-action="draft" data-id="' + d.id + '" data-acc="0">Discard</button></div>' : '') + '</div>';
    }).join('') + '</section>';
  var hard = b.items.filter(function (i) { return i.kind === 'Hard constraint'; }).length, priv = b.items.filter(function (i) { return i.vis === 'private'; }).length;
  var confirmBox = st.v ? '<div class="subbox">' + chip('Brief v' + st.v + ' confirmed ' + timeStr(st.at), 'ok') + '<p class="small muted">Locked. Editing would create v' + (st.v + 1) + '; changing a hard constraint also increments the room’s constraint version and voids current approvals (editing is not in this prototype).</p></div>'
    : '<div class="subbox binding"><h3>Confirm brief v1</h3><p class="small">Your agent will negotiate with ' + hard + ' hard constraints and ' + (b.items.length - hard) + ' other items. ' + priv + ' items stay private to you and your agent.</p>' +
      (r === 'finance' && S.drafts.some(function (d) { return d.state === 'pending'; }) ? '<p class="small" style="color:var(--warn)">1 extracted draft is still pending and will be left out.</p>' : '') +
      '<button class="btn primary" data-action="confirm-brief">Confirm brief v1</button></div>';
  var others = ROLE_KEYS.filter(function (x) { return x !== r; }).map(function (x) { var s2 = S.briefs[x]; return '<div class="apprrow"><span>' + roleTag(x) + '</span><span class="small muted">' + (s2.v ? 'v' + s2.v + ' confirmed ' + timeStr(s2.at) : 'not confirmed yet') + '</span></div>'; }).join('');
  return '<div class="page">' + roomHead('brief') + banner() + '<div class="grid3" style="grid-template-columns:minmax(0,1fr) 340px">' +
    '<div><section class="panel privzone"><div class="panel-h"><h2>My private brief</h2>' + privTag() + '</div><div class="small muted">Goal: ' + esc(b.goal) + '</div><div style="margin-top:8px">' + items + '</div></section>' + drafts + '</div>' +
    '<div>' + confirmBox + '<section class="panel" style="margin-top:14px"><h2>Other participants</h2><div style="margin-top:6px">' + others + '</div><div class="tiny muted">Only version and time are shown, never content.</div></section>' + disclosedPanel() + '</div></div></div>';
}

function resultsPage() {
  var ex = S.execution && !S.execution.pending ? S.execution : null, body;
  if (!ex) {
    var w = waitingOn(), p = current(), fails = p ? checksFor(p, S.cv, S.role).filter(function (c) { return !c.pass; }) : [];
    body = '<section class="panel"><h2>No executed agreement yet</h2><ul class="small">' + (!p ? '<li>No proposal has been recorded.</li>' : '') +
      fails.map(function (c) { return '<li>v' + p.v + ' fails ' + esc(c.label.toLowerCase()) + ': ' + esc(c.detail) + '</li>'; }).join('') +
      (w.length ? '<li>Waiting on: ' + esc(w.join(', ')) + '</li>' : '') + '</ul><a class="btn" href="#/room">Back to workbench</a></section>';
  } else {
    var used = ex.approvals.map(function (a) { return roleTag(a.role) + ' ' + timeStr(a.at); }).join(' · ');
    var fin = S.role === 'finance' ? '<div class="money-break"><div class="ln"><span>Committed before</span><span>' + money(ex.before) + '</span></div><div class="ln"><span>This commitment</span><span>+ ' + money(ex.amount) + '</span></div><div class="ln tot"><span>Committed after</span><span>' + money(ex.before + ex.amount) + '</span></div><div class="ln"><span>Cap at execution (constraints v' + ex.cv + ')</span><span>' + money(ex.cap) + '</span></div><div class="ln"><span>Remaining</span><span>' + money(ex.cap - ex.before - ex.amount) + '</span></div><div class="tiny muted">' + privTag('Finance only') + ' Snapshot taken at execution.</div></div>'
      : '<div class="money-break"><div class="ln"><span>Commitment for this change</span><span>' + money(ex.amount) + '</span></div><div class="tiny muted">Budget totals are private to Finance.</div></div>';
    var tasks = S.tasks.map(function (t) {
      var mine = t.role === S.role;
      return '<div class="apprrow"><label class="row" style="gap:6px"><input type="checkbox" data-action="task" data-id="' + t.id + '"' + (t.done ? ' checked' : '') + (mine ? '' : ' disabled') + '> <span class="' + (t.done ? 'strike' : '') + '">' + esc(t.title) + '</span></label><span class="small muted">' + ROLES[t.role].label + ' · due ' + shortDate(t.due) + '</span></div>';
    }).join('');
    var allDec = S.approvals.slice().reverse().map(function (a) {
      var lab = a.decision === 'reject' ? ['Rejected', 'danger'] : (a.pv === ex.pv && a.cv === ex.cv) ? ['Used for execution', 'ok'] : ['No longer applies', 'warn'];
      return '<div class="apprrow"><span>' + roleTag(a.role) + ' ' + (a.decision === 'reject' ? 'rejected' : 'approved') + ' v' + a.pv + ' · constraints v' + a.cv + ' <span class="tiny muted">' + timeStr(a.at) + '</span></span>' + chip(lab[0], lab[1]) + '</div>';
    }).join('');
    var rq = S.requests.filter(function (x) { return x.status === 'answered'; }).pop();
    body = '<div class="split2"><section class="panel" style="border-left:5px solid var(--ok)"><div class="row between"><h2>Change order ' + ex.co + '</h2>' + chip('Simulated', 'warn') + '</div>' +
      '<dl class="terms" style="margin-top:8px"><dt>Based on</dt><dd>Proposal v' + ex.pv + ' · constraints v' + ex.cv + '</dd><dt>Scope</dt><dd>' + esc(scopeNames(ex.scope)) + '</dd><dt>Deferred</dt><dd>' + (ex.deferred.length ? esc(scopeNames(ex.deferred)) : '—') + '</dd><dt>Delivery</dt><dd>' + dateStr(ex.date) + '</dd><dt>Approved by</dt><dd>' + used + '</dd><dt>Operation</dt><dd class="mono">' + ex.op + '</dd><dt>Recorded</dt><dd>' + timeStr(ex.at) + '</dd></dl>' +
      '<p class="tiny muted">An internal record only. No payment, transfer or e-signature happens. Repeated submissions reuse the same operation and create nothing new.</p></section>' +
      '<section class="panel"><h2>Budget commitment</h2><div style="margin-top:8px">' + fin + '</div><h2 style="margin-top:14px">Tasks</h2><div class="tiny muted">Only the assignee can update a task.</div>' + tasks + '</section></div>' +
      '<section class="panel"><h2>How this result came to be</h2><ol class="trace" style="margin-top:8px"><li>Constraints v1: briefs confirmed; run #1 produced v1 (blocked) and v2.</li>' + (S.cv > 1 ? '<li>Finance changed a budget constraint (constraints v' + S.cv + '); v2 was blocked and its approvals stopped counting.</li>' : '') +
      (rq ? '<li>' + ROLES[rq.target].label + ' answered ' + rq.id + ' (option ' + rq.answer.opt + ').</li>' : '') + '<li>Proposal v' + ex.pv + ' from confirmed quote ' + OFFERS[current().offer].id + ' passed every check.</li><li>Customer, Provider and Finance approved v' + ex.pv + ' under constraints v' + ex.cv + '.</li><li>One transaction wrote ' + ex.co + ', the commitment and ' + S.tasks.length + ' tasks.</li></ol></section>' +
      '<section class="panel"><h2>Decision record</h2><div class="small muted">Every approval and rejection, including ones that no longer apply.</div>' + allDec + '</section>';
  }
  return '<div class="page">' + roomHead('results') + banner() + body + '</div>';
}


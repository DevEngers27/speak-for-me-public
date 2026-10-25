/* ui-center.js —— 中栏：取舍请求、失败卡、当前方案卡（范围/金额/交付/版本/校验/建议 vs 批准）、历史版本 */
var PSTAT = { executed: ['Executed', 'ok'], superseded: ['Superseded', 'muted'], 'superseded-blocked': ['Superseded · fails current checks', 'muted'], blocked: ['Blocked', 'danger'], rejected: ['Rejected', 'danger'], awaiting: ['Ready for approval', 'info'] };

function centerCol() {
  var html = '', st = roomStatus(), rq = openRequest(), run = lastRun();
  if (rq) html += requestCard(rq);
  if (st === 'run_failed') html += '<section class="request" style="border-color:var(--danger);background:#fffafa"><div class="row between"><h2>Run #' + run.id + ' failed</h2>' + chip('No changes made', 'muted') + '</div>' +
    '<p class="small">' + esc(msgFor(run.turns[0] && run.turns[0].err, S.role) || 'The agent run was interrupted.') + '</p>' +
    '<p class="small muted">The validator rejected every attempt, so no proposal was recorded. Retry starts a new run against constraints v' + S.cv + '.</p>' +
    '<button class="btn primary" data-action="retry-run">Retry run</button></section>';
  if (S.execution && !S.execution.pending) html += '<section class="panel" style="border-left:5px solid var(--ok)"><div class="row between"><h2>Executed: change order ' + S.execution.co + '</h2><a class="btn sm" href="#/room/results">View records</a></div>' +
    '<div class="small muted">Change order, budget commitment and ' + S.tasks.length + ' tasks were written once (operation <span class="mono">' + S.execution.op + '</span>).</div></section>';
  var p = current();
  if (!p) {
    html += '<section class="panel"><h2>No proposal yet</h2><p class="small muted">' + (st === 'collecting' ? 'Agents start once all three briefs are confirmed. Nothing is proposed from unconfirmed information.' : 'Agents are working on the first proposal.') + '</p>' +
      (st === 'negotiating' ? '<div class="small"><span class="spin"></span> Waiting for the first agent turn…</div>' : '') + '</section>';
  } else html += proposalCard(p);
  if (S.proposals.length) html += versionsFold();
  return html;
}

function requestCard(rq) {
  var mine = rq.target === S.role;
  var opts = rq.options.map(function (o) {
    var p = o.offer ? OFFERS[o.offer] : null;
    var ck = p ? checksFor({ offer: o.offer, scope: p.scope, cost: p.cost, date: p.date }, S.cv, S.role) : [];
    return '<div class="opt' + (UI.sel === o.id ? ' sel' : '') + '"><div class="row between"><b>Option ' + o.id + ': ' + esc(o.title) + '</b>' + (p ? '<span class="vchip">' + p.id + '</span>' : '') + '</div>' +
      '<div class="small">' + esc(o.summary) + '</div><div class="small" style="color:var(--warn)">Trade-off: ' + esc(o.tradeoff) + '</div>' +
      (ck.length ? '<ul class="checks">' + ck.map(function (c) { return '<li><span class="ck ' + (c.pass ? 'pass">✓' : 'fail">✕') + '</span><span class="small">' + esc(c.detail) + '</span></li>'; }).join('') + '</ul>' : '') +
      (mine ? '<button class="btn ' + (UI.sel === o.id ? 'primary' : '') + '" data-action="pick" data-opt="' + o.id + '">' + (UI.sel === o.id ? 'Selected' : 'Choose option ' + o.id) + '</button>' : '') + '</div>';
  }).join('');
  return '<section class="request" id="request" aria-labelledby="rqh"><div class="row between"><h2 id="rqh">' + esc(rq.id) + ' · Decision for ' + ROLES[rq.target].label + you(rq.target) + '</h2>' + chip('Asked by run #' + rq.run, 'warn') + '</div>' +
    '<p style="margin:6px 0 0">' + esc(rq.question) + '</p>' +
    '<p class="small muted" style="margin:4px 0 0">Both options come from confirmed quotes and pass code checks under constraints v' + S.cv + '. Agents did not pick: this is a human choice.</p>' +
    '<div class="optgrid">' + opts + '</div>' +
    (mine ? '<div style="margin-top:10px"><label class="small" for="rqnote">Note for your agent (private, optional)</label><textarea id="rqnote" rows="2" data-bind="note" placeholder="e.g. Permissions can wait if go-live stays on Nov 20.">' + esc(UI.note) + '</textarea>' +
      '<div class="actions"><button class="btn primary" data-action="answer"' + (UI.sel ? '' : ' disabled') + '>Submit answer</button><span class="reason">' + (UI.sel ? 'Creates a new proposal version that everyone must approve.' : 'Choose an option first.') + '</span></div></div>'
      : '<div class="small muted" style="margin-top:10px">Only ' + ROLES[rq.target].label + ' can answer. You will be asked to approve the resulting version.</div>') + '</section>';
}

function moneyBlock(p) {
  var cap = capNow(), total = COMMITTED + p.cost;
  if (S.role === 'finance') return '<div class="money-break"><div class="ln"><span>Already committed</span><span>' + money(COMMITTED) + '</span></div><div class="ln"><span>This change (v' + p.v + ')</span><span>+ ' + money(p.cost) + '</span></div>' +
    '<div class="ln tot"><span>Total after execution</span><span>' + money(total) + '</span></div><div class="ln" style="color:' + (total <= cap ? 'var(--ok)' : 'var(--danger)') + '"><span>Cap (constraints v' + S.cv + ')</span><span>' + money(cap) + (total > cap ? ' · over by ' + money(total - cap) : ' · ' + money(cap - total) + ' left') + '</span></div>' +
    '<div class="tiny muted" style="margin-top:4px">' + privTag('Finance only') + ' Others see only the pass/fail result.</div></div>';
  return '<div class="money-break"><div class="ln"><span>This change (v' + p.v + ')</span><span>' + money(p.cost) + '</span></div><div class="ln small"><span>Budget</span><span>' + (total <= cap ? '✓ Within Finance’s limit' : '✕ Over Finance’s limit') + '</span></div>' +
    '<div class="tiny muted" style="margin-top:4px">Finance has not shared the cap or committed amounts.</div></div>';
}

function proposalCard(p) {
  var stt = proposalStatus(p), lab = PSTAT[stt], o = OFFERS[p.offer], role = S.role, rs = roomStatus();
  var ck = checksFor(p, S.cv, role);
  var whatChanged = '';
  if (stt === 'blocked' && p.cv < S.cv) {
    var prev = capAt(p.cv), nowc = capNow();
    whatChanged = '<div class="diff" style="margin-bottom:10px"><b>What changed:</b> constraints v' + p.cv + ' → v' + S.cv + '. ' +
      (role === 'finance' ? 'You lowered the cap ' + money(prev) + ' → ' + money(nowc) + '; v' + p.v + ' totals ' + money(COMMITTED + p.cost) + '.' : 'Finance updated a budget constraint; v' + p.v + ' no longer fits it.') +
      ' Approvals given under v' + p.cv + ' are kept in history but no longer count.</div>';
  }
  var recs = S.recs.filter(function (x) { return x.pv === p.v; });
  var recHtml = ROLE_KEYS.map(function (r) {
    var x = recs.filter(function (y) { return y.role === r; }).pop();
    if (!x) return '<div class="apprrow"><span>' + agentTag(r) + '</span><span class="muted small">no recommendation</span></div>';
    var old = x.cv !== S.cv;
    return '<div class="apprrow"><span>' + agentTag(r) + '</span><span class="small' + (old ? ' strike' : '') + '">' + (x.action === 'recommend_accept' ? 'recommends accepting' : 'recommends rejecting') + (old ? ' (constraints v' + x.cv + ')' : '') + '</span></div>';
  }).join('');
  var apprHtml = ROLE_KEYS.map(function (r) {
    var d = decisionOf(r, p), t = { approved: ['Approved', 'ok'], stale: ['No longer applies', 'warn'], rejected: ['Rejected', 'danger'], pending: ['Pending', 'muted'] }[d.state];
    var sub = d.d ? (d.state === 'stale' ? '<div class="tiny muted strike">approved under constraints v' + d.d.cv + ' · ' + timeStr(d.d.at) + '</div>' : d.state === 'rejected' ? '<div class="tiny muted">“' + esc(d.d.reason) + '”</div>' : '<div class="tiny muted">under constraints v' + d.d.cv + ' · ' + timeStr(d.d.at) + '</div>') : '';
    return '<div class="apprrow"><span>' + roleTag(r) + you(r) + sub + '</span>' + chip(t[0], t[1]) + '</div>';
  }).join('');
  var mine = decisionOf(role, p), canAct = rs === 'awaiting' && stt === 'awaiting' && mine.state !== 'approved';
  var why = stt === 'executed' ? 'Executed. Changes now need a new round.' : stt === 'blocked' ? 'Approval is disabled: v' + p.v + ' fails a check under constraints v' + S.cv + '.' :
    rs === 'negotiating' ? 'Approval is disabled while agents are negotiating.' : rs === 'needs_input' ? 'Approval reopens after the pending decision.' : stt === 'superseded' ? 'A newer version exists.' :
    mine.state === 'approved' ? 'You approved v' + p.v + ' under constraints v' + S.cv + '. Waiting on others.' : 'Your approval applies only to v' + p.v + ' under constraints v' + S.cv + '. An agent’s recommendation never counts as approval.';
  var records = '<div class="subbox" style="margin-top:12px"><h3>On final approval, the system creates</h3><ul class="small" style="margin:6px 0 0;padding-left:18px"><li>Change order for v' + p.v + ' (' + esc(scopeNames(p.scope)) + ')</li><li>Budget commitment of ' + money(p.cost) + '</li><li>' + (p.scope.length + 2) + ' tasks assigned to Provider, Customer and Finance</li></ul><div class="tiny muted">Internal records only. Written once, in one transaction.</div></div>';
  return '<article class="pcard' + (stt === 'blocked' ? ' blocked' : '') + '" id="proposal" aria-labelledby="ph">' +
    '<div class="pcard-h"><div class="row"><h2 id="ph">Proposal v' + p.v + '</h2>' + chip(lab[0], lab[1]) + '<span class="vchip">checked against constraints v' + S.cv + '</span></div><span class="small muted">' + esc(p.origin) + ' · ' + timeStr(p.at) + '</span></div>' +
    '<div class="pcard-b">' + whatChanged + '<div class="split2"><dl class="terms"><dt>Scope</dt><dd>' + esc(scopeNames(p.scope)) + '</dd><dt>Deferred</dt><dd>' + (p.deferred.length ? esc(scopeNames(p.deferred)) + ' (phase 2)' : '—') + '</dd>' +
    '<dt>Delivery</dt><dd>' + dateStr(p.date) + '</dd><dt>Source</dt><dd>Quote ' + o.id + ' v' + o.v + ' (confirmed by Provider)</dd><dt>Version</dt><dd>v' + p.v + ', recorded under constraints v' + p.cv + '</dd></dl>' + moneyBlock(p) + '</div>' +
    '<h3 style="margin-top:12px">Code checks</h3><ul class="checks">' + ck.map(function (c) {
      return '<li><span class="ck ' + (c.pass ? 'pass">✓' : 'fail">✕') + '</span><span><b>' + esc(c.label) + '</b> · ' + esc(c.detail) + ' <span class="mono muted">' + c.code + '</span>' + (c.privateTo && c.mine ? ' ' + privTag('Detail only you see') : '') + '</span></li>';
    }).join('') + '</ul>' +
    '<div class="split2" style="margin-top:12px"><div class="subbox advisory"><h3>Agent recommendations · advisory</h3>' + recHtml + '<div class="tiny muted" style="margin-top:6px">Agents can recommend. They cannot approve.</div></div>' +
    '<div class="subbox binding"><h3>Human approvals · binding</h3>' + apprHtml + '<div class="tiny muted" style="margin-top:6px">All three are required, on this exact version and constraint version.</div></div></div>' +
    (stt === 'awaiting' || stt === 'blocked' ? records : '') +
    (stt === 'executed' || stt.indexOf('superseded') === 0 ? '' : '<div class="actions"><button class="btn primary" data-action="approve"' + (canAct ? '' : ' disabled') + '>Approve v' + p.v + ' · constraints v' + S.cv + '</button>' +
      '<button class="btn danger" data-action="open-reject"' + (canAct ? '' : ' disabled') + '>Reject…</button><span class="reason">' + esc(why) + '</span></div>') + '</div></article>';
}


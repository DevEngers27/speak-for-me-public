/* ui-right.js —— 右栏：代理回合状态 + 事件时间线（紧凑版）；以及中栏底部的历史版本折叠 */
var RUN_TONE = { running: ['In progress', 'info'], completed: ['Completed', 'ok'], failed: ['Failed', 'danger'], discarded: ['Discarded (stale)', 'muted'] };
var ACT_LABEL = { propose: 'propose', counter: 'counter', clarify: 'clarify', recommend_accept: 'recommend_accept', reject: 'reject', escalate: 'ask_human' };

function rightCol() { return runPanel() + timelinePanel(10); }

function turnIcon(t) {
  if (t.status === 'running' || t.status === 'retrying') return '<span class="spin" aria-label="in progress"></span>';
  return { queued: '<span class="muted">○</span>', done: '<span class="ck pass">✓</span>', failed: '<span class="ck fail">✕</span>', skipped: '<span class="muted">–</span>' }[t.status] || '';
}
function runBlock(run, open) {
  var tone = RUN_TONE[run.status];
  var turns = run.turns.map(function (t) {
    var m = msgFor(t.msg, S.role), e = msgFor(t.err, S.role);
    return '<div class="turn"><span class="tstat">' + turnIcon(t) + '</span><div><div class="row">' + agentTag(t.role) + '<span class="act">' + ACT_LABEL[t.action] + '</span>' +
      (t.attempt > 1 || t.status === 'retrying' ? '<span class="tiny muted">attempt ' + t.attempt + ' of ' + t.max + '</span>' : '') + '</div>' +
      (m ? '<div class="small">' + esc(m) + '</div>' : (t.status === 'queued' ? '<div class="small muted">Queued</div>' : t.status === 'skipped' ? '<div class="small muted">Skipped (run stopped)</div>' : t.status === 'failed' ? '<div class="small muted">No valid output</div>' : '<div class="small muted">Thinking…</div>')) +
      (t.errs || (t.err ? [t.err] : [])).map(function (x, i, arr) { return '<div class="' + (t.status === 'failed' && i === arr.length - 1 ? 'errline' : 'retryline') + '">' + esc(msgFor(x, S.role)) + '</div>'; }).join('') + '</div></div>';
  }).join('');
  return '<div class="subbox" style="margin-top:8px"><div class="row between"><b>Run #' + run.id + ' · ' + (run.kind === 'initial' ? 'Negotiation' : 'Renegotiation') + '</b>' + chip(tone[0], tone[1]) + '</div>' +
    '<div class="tiny muted">Trigger: ' + esc(run.trigger) + ' · against constraints v' + run.cv + (run.outcome ? ' · Outcome: ' + esc(run.outcome) : '') + '</div>' +
    (open ? '<div style="margin-top:6px">' + (turns || '<div class="small muted"><span class="spin"></span> Starting…</div>') + '</div>' : '') + '</div>';
}
function runPanel() {
  var runs = S.runs.slice().reverse();
  var body = runs.length ? runBlock(runs[0], true) + (runs.length > 1 ? '<details style="margin-top:8px"><summary class="small">Earlier runs (' + (runs.length - 1) + ')</summary>' + runs.slice(1).map(function (r) { return runBlock(r, true); }).join('') + '</details>' : '')
    : '<div class="small muted">No agent run yet. Runs start automatically when all briefs are confirmed, when a constraint changes, or after a rejection.</div>';
  return '<section class="panel" aria-labelledby="rh"><div class="panel-h"><h2 id="rh">Agent turns</h2>' + (S.forceFail ? chip('Failure simulation on', 'danger') : '') + '</div>' + body +
    '<div class="tiny muted" style="margin-top:8px">Shows actions and public messages only, never hidden model reasoning. Every agent output is validated by code before it changes anything.</div></section>';
}

var EV_ICON = { run_started: 'Run', run_completed: 'Run', run_failed: 'Run', run_retried: 'Run', run_turn_retry: 'Run', run_discarded: 'Run', proposal_recorded: 'Proposal', proposal_blocked: 'Blocked', constraints_changed: 'Constraint', decision_recorded: 'Decision', human_request_opened: 'Request', human_request_answered: 'Request', execution_completed: 'Executed', brief_confirmed: 'Brief', offer_confirmed: 'Quote', task_updated: 'Task', room_created: 'Room', participant_joined: 'Member' };
function timelineItems(list) {
  return list.map(function (e) {
    var isNew = !UI.seen[e.id];
    return '<li class="' + (e.priv ? 'priv ' : '') + (isNew ? 'new' : '') + '"><div class="meta">' + timeStr(e.at) + ' · ' + (EV_ICON[e.type] || e.type) + ' · ' + (e.actor === 'system' ? 'System' : ROLES[e.actor] ? ROLES[e.actor].label : e.actor) + (e.priv ? ' · ' + privTag('Private to you') : '') + '</div>' + esc(e.text) + '</li>';
  }).join('');
}
function timelinePanel(n) {
  var list = eventsFor(S.role), shown = list.slice(0, n);
  return '<section class="panel" aria-labelledby="th"><div class="panel-h"><h2 id="th">Timeline</h2><a class="small" href="#/room/timeline">Full timeline (' + list.length + ')</a></div><ul class="tl" aria-live="polite">' + timelineItems(shown) + '</ul></section>';
}
function markSeen() { eventsFor(S.role).forEach(function (e) { UI.seen[e.id] = 1; }); }

function versionsFold() {
  var rows = S.proposals.slice().reverse().map(function (p) {
    var s = PSTAT[proposalStatus(p)];
    return '<tr' + (p === current() ? ' aria-current="true"' : '') + '><td><b>v' + p.v + '</b><div class="tiny muted">constraints v' + p.cv + '</div></td><td>' + esc(scopeNames(p.scope)) + (p.deferred.length ? '<div class="tiny muted">Deferred: ' + esc(scopeNames(p.deferred)) + '</div>' : '') + '</td><td>' + money(p.cost) + '</td><td>' + shortDate(p.date) + '</td><td>' + chip(s[0], s[1]) + '</td><td class="small muted">' + esc(p.origin) + '</td></tr>';
  }).join('');
  return '<details class="fold"' + (S.proposals.length > 1 ? '' : '') + '><summary>Version history (' + S.proposals.length + ') · append-only</summary><div class="scroll-x"><table class="vtable"><thead><tr><th>Version</th><th>Scope</th><th>Change cost</th><th>Delivery</th><th>Status now</th><th>Origin</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="tiny muted">Older versions are never edited. Status is re-derived against the current constraints (v' + S.cv + ').</div></div></details>';
}

/* 完整时间线页面（从 ui-pages.js 移来以控制单文件大小） */
function timelinePage() {
  var f = UI.tlFilter, groups = { decisions: ['decision_recorded', 'human_request_opened', 'human_request_answered', 'execution_completed'], constraints: ['constraints_changed', 'proposal_blocked', 'brief_confirmed', 'offer_confirmed'], runs: ['run_started', 'run_completed', 'run_failed', 'run_retried', 'run_turn_retry', 'run_discarded', 'proposal_recorded'] };
  var list = eventsFor(S.role).filter(function (e) { return f === 'all' || (f === 'private' ? e.priv : groups[f].indexOf(e.type) >= 0); });
  var btn = function (k, l) { return '<button class="btn sm' + (f === k ? ' primary' : '') + '" data-action="tl" data-f="' + k + '">' + l + '</button>'; };
  return '<div class="page">' + roomHead('timeline') + '<section class="panel"><div class="panel-h"><h2>Event timeline · append-only</h2><div class="row">' + btn('all', 'All') + btn('decisions', 'Decisions') + btn('constraints', 'Constraints & briefs') + btn('runs', 'Agent runs') + btn('private', 'Private to me') + '</div></div>' +
    '<div class="small muted" style="margin-bottom:8px">Showing what ' + ROLES[S.role].label + ' may see. Private events of other people are not sent to you. The log records actions, versions and outcomes, not hidden model reasoning.</div><ul class="tl">' + timelineItems(list) + '</ul></section></div>';
}

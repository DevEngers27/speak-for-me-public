/* ui-common.js —— 顶栏、房间头部、状态横幅与小组件 */
var UI = { drawer: window.innerWidth > 900, /* 窄屏默认收起原型控制 */ modal: null, capInput: '4800', rejectReason: '', rejectTpl: '', sel: null, note: '', seen: {}, tlFilter: 'all', toast: null };

function chip(text, tone) { return '<span class="chip t-' + (tone || 'muted') + '">' + esc(text) + '</span>'; }
function roleTag(r) {
  if (r === 'system') return '<span class="rdot s"></span><b>System</b>';
  return '<span class="rdot ' + ROLES[r].color + '"></span><b class="role-' + ROLES[r].color + '">' + ROLES[r].label + '</b>';
}
function agentTag(r) { return '<span class="rdot ' + ROLES[r].color + '"></span><b class="role-' + ROLES[r].color + '">' + ROLES[r].agent + '</b>'; }
function privTag(text) { return '<span class="privtag" title="Only you and your agent can see this">&#128274; ' + esc(text || 'Only you can see this') + '</span>'; }
function you(r) { return r === S.role ? ' <span class="muted small">(you)</span>' : ''; }

function topbar(route) {
  var btns = ROLE_KEYS.map(function (r) {
    return '<button data-action="role" data-role="' + r + '" aria-pressed="' + (S.role === r) + '">' + ROLES[r].label + '</button>';
  }).join('');
  return '<header class="topbar">' +
    '<a class="brand" href="#/rooms">Speak <span>for</span> Me</a>' +
    '<nav class="topnav"><a href="#/rooms">Rooms</a></nav>' +
    '<span class="simbadge" title="All amounts, people and quotes are simulated fixture data">Simulated data</span>' +
    '<div class="spacer"></div>' +
    '<div class="roleswitch" role="group" aria-label="View as (prototype only)"><span class="lbl" title="Replaces real sign-in. In the product, identity comes from your account.">Prototype only · view as</span>' + btns + '</div>' +
    '<span class="small" style="color:#cfd5ea">' + esc(ROLES[S.role].person) + ' · ' + esc(ROLES[S.role].org) + '</span>' +
    '<button class="ghost-dark" data-action="drawer">' + (UI.drawer ? 'Hide' : 'Show') + ' prototype controls</button>' +
    '</header>';
}

function roomHead(tab) {
  var st = roomStatus(), p = current();
  var tabs = [['room', 'Workbench'], ['brief', 'My brief'], ['results', 'Results'], ['timeline', 'Timeline']].map(function (t) {
    var href = t[0] === 'room' ? '#/room' : '#/room/' + t[0];
    var dot = (t[0] === 'brief' && !S.briefs[S.role].v) ? ' <span class="chip t-warn">to confirm</span>' : '';
    return '<a href="' + href + '"' + (tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + dot + '</a>';
  }).join('');
  return '<div class="roomhead"><div>' +
    '<div class="crumb"><a href="#/rooms">Rooms</a> / Scope change</div>' +
    '<div class="row"><h1 class="roomtitle">Clinic portal — scope change Q4</h1>' + chip(STATUS_LABEL[st], STATUS_TONE[st]) + '</div>' +
    '<div class="muted small">Shared goal: agree scope, price and delivery for the clinic admin portal change request. Required approvers: Customer, Provider, Finance.</div>' +
    '</div><div class="row">' +
    '<span class="vchip" title="Latest proposal version">Proposal ' + (p ? 'v' + p.v : '—') + '</span>' +
    '<span class="vchip" title="Constraint version: any confirmed change to a hard constraint increments it and voids older approvals">Constraints v' + S.cv + '</span>' +
    '<span class="vchip">Viewing as ' + ROLES[S.role].label + '</span>' +
    '</div></div><nav class="tabs" aria-label="Room sections">' + tabs + '</nav>';
}

function bannerState() {
  var st = roomStatus(), p = current(), run = lastRun(), rq = openRequest(), role = S.role;
  var b = { tone: 'info', state: STATUS_LABEL[st], why: '' };
  if (st === 'collecting') {
    var n = ROLE_KEYS.filter(function (r) { return S.briefs[r].v; }).length;
    b.state = 'Collecting private briefs (' + n + ' of 3 confirmed)'; b.tone = 'warn';
    b.why = 'Negotiation starts automatically once every participant confirms a brief. Others only see that a brief is confirmed, never its content.';
  } else if (st === 'negotiating') {
    var blocked = p && !passes(p, S.cv);
    b.state = blocked ? 'Proposal v' + p.v + ' is blocked · agents are renegotiating (run #' + run.id + ')' : 'Agents are negotiating (run #' + run.id + ')';
    b.tone = blocked ? 'danger' : 'info';
    b.why = (blocked ? 'Constraints changed to v' + S.cv + '. v' + p.v + ' can no longer execute and approvals given under older constraints no longer count. ' : '') +
      'Agents can propose, counter, clarify and recommend. They cannot approve anything.';
  } else if (st === 'needs_input') {
    if (rq) {
      b.tone = 'warn';
      b.state = rq.target === role ? 'Your decision is needed (' + rq.id + ')' : 'Waiting on ' + ROLES[rq.target].label + ' to decide (' + rq.id + ')';
      b.why = rq.target === role ? rq.question + ' Agents will not choose for you.' : 'The choice depends on the ' + ROLES[rq.target].label + '’s priorities. Their private reasons are not shown to you.';
    } else { b.tone = 'warn'; b.state = 'Proposal v' + p.v + ' was rejected'; b.why = 'A renegotiation run will look for another feasible option.'; }
  } else if (st === 'blocked') {
    b.tone = 'danger'; b.state = 'Proposal v' + p.v + ' is blocked';
    b.why = 'It fails a check under constraints v' + S.cv + '. No proposal can execute until a feasible option is found or a constraint changes.';
  } else if (st === 'awaiting') {
    b.state = 'Awaiting human approval of v' + p.v + ' under constraints v' + S.cv;
    b.why = 'Each person approves this exact version. Agent recommendations are shown separately and never count as approval.';
  } else if (st === 'run_failed') {
    b.tone = 'danger'; b.state = 'Negotiation run #' + run.id + ' failed';
    b.why = 'The agent could not produce a valid output after ' + (run.error === 'interrupted' ? 'an interruption' : '3 attempts') + '. Nothing was changed: the current proposal, approvals and records are as before.';
  } else if (st === 'executing') {
    b.state = 'Executing v' + p.v + '…'; b.why = 'Writing the change order, budget commitment and tasks in one transaction.';
  } else if (st === 'executed') {
    b.tone = 'ok'; b.state = 'Executed · Change order ' + S.execution.co;
    b.why = 'Based on proposal v' + S.execution.pv + ' under constraints v' + S.execution.cv + '. Internal records only: no payment, transfer or e-signature happened.';
  }
  return b;
}

function banner() {
  var b = bannerState(), todos = todosFor(S.role), w = waitingOn();
  var right = todos.length ? '<div class="needs"><h3>Needs you</h3>' + todos.map(function (t) {
    return '<div class="item"><span class="small">' + esc(t.text) + '</span>' +
      (t.action ? '<button class="btn sm primary" data-action="' + t.action + '">' + esc(t.cta) + '</button>' : '<a class="btn sm primary" href="' + t.go + '" data-anchor="' + (t.anchor || '') + '">' + esc(t.cta) + '</a>') + '</div>';
  }).join('') + '</div>'
    : '<div class="needs"><h3>Needs you</h3><div class="small muted">Nothing right now.' + (w.length ? ' Waiting on: ' + esc(w.join(', ')) + '.' : '') + '</div></div>';
  return '<section class="banner t-' + b.tone + '-b" aria-live="polite"><div><div class="state">' + esc(b.state) + '</div><div class="why">' + esc(b.why) + '</div></div>' + right + '</section>';
}

/* app.js —— 路由、渲染、事件委托、弹窗与原型控制抽屉（抽屉仅供原型演示，不属于产品界面） */
var app = document.getElementById('app');

function route() { var h = (location.hash || '#/rooms').replace(/^#\//, ''); return h === 'room' ? 'room' : h.indexOf('room/') === 0 ? h.slice(5) : 'rooms'; }

function capPreview(dollars) {
  var c = Math.round(parseFloat(dollars) * 100), p = current();
  if (!(c >= 0)) return '<span class="errline">Enter an amount.</span>';
  if (c < COMMITTED) return '<span class="errline">Cap cannot be below already committed spend (' + money(COMMITTED) + ').</span>';
  if (c === capNow()) return '<span class="muted">Same as the current cap.</span>';
  var out = ['Constraints v' + S.cv + ' → v' + (S.cv + 1) + '. The change is recorded; older versions stay in history.'];
  if (p && !S.execution) {
    var total = COMMITTED + p.cost, n = S.approvals.filter(function (a) { return a.pv === p.v && a.cv === S.cv && a.decision === 'approve'; }).length;
    if (total > c) out.push('<b style="color:var(--danger)">Proposal v' + p.v + ' (' + money(total) + ' total) will be blocked.</b>', n + ' approval(s) given under v' + S.cv + ' will stop counting.', 'A renegotiation run starts automatically.');
    else out.push('v' + p.v + ' still fits (' + money(total) + '), but approvals must be given again under v' + (S.cv + 1) + '.');
  }
  return '<ul class="small" style="padding-left:18px;margin:6px 0">' + out.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
}

function modal() {
  if (UI.modal === 'cap') return '<div class="modal-bg"><div class="modal" role="dialog" aria-labelledby="mh"><h2 id="mh">Lower budget cap</h2>' + privTag('Finance only') +
    '<p class="small">Current cap ' + money(capNow()) + ' · committed ' + money(COMMITTED) + '. Others will only see that a budget constraint changed.</p>' +
    '<label class="small" for="capin">New cap (USD)</label><input id="capin" type="number" step="50" data-bind="capInput" value="' + esc(UI.capInput) + '">' +
    '<div id="cap-preview">' + capPreview(UI.capInput) + '</div><div class="actions"><button class="btn danger" data-action="cap-confirm">Confirm new cap</button><button class="btn" data-action="modal-close">Cancel</button></div></div></div>';
  if (UI.modal === 'reject') { var p = current(); return '<div class="modal-bg"><div class="modal" role="dialog" aria-labelledby="mh"><h2 id="mh">Reject proposal v' + p.v + '</h2>' +
    '<p class="small muted">A reason is required. It is shared with the room and starts a renegotiation run.</p><label class="small" for="rt">Reason</label>' +
    '<select id="rt" data-bind="rejectTpl"><option value="">Choose a template…</option><option>Delivery date does not work for us</option><option>Scope does not cover what we need</option><option>Payment terms are not acceptable</option><option>Other</option></select>' +
    '<label class="small" for="rr" style="display:block;margin-top:8px">Details</label><textarea id="rr" rows="3" data-bind="rejectReason">' + esc(UI.rejectReason) + '</textarea>' +
    '<div class="actions"><button class="btn danger" data-action="reject-confirm">Reject v' + p.v + '</button><button class="btn" data-action="modal-close">Cancel</button></div></div></div>'; }
  return '';
}

function drawer() {
  if (!UI.drawer) return '';
  var jumps = [[1, 'Start: Finance brief pending'], [2, 'v2 awaiting approvals'], [3, 'Customer + Provider approved v2'], [4, 'After budget cut: trade-off open'], [5, 'Executed']];
  return '<aside class="drawer" aria-label="Prototype controls"><div class="row between"><h3>Prototype controls</h3><span class="tiny">not product UI</span></div>' +
    '<div class="tiny" style="margin:4px 0 8px;color:#aab3d6">Role switch above replaces real sign-in. Jump to a moment, or click through from the start.</div>' +
    '<div class="stack-s">' + jumps.map(function (j) { return '<button class="btn sm" style="width:100%;text-align:left" data-action="jump" data-n="' + j[0] + '">' + j[0] + '. ' + j[1] + '</button>'; }).join('') + '</div>' +
    '<div class="stack-s" style="margin-top:10px"><button class="btn sm" style="width:100%" data-action="cut">Budget cut to $4,800 (as Finance)</button>' +
    '<label><input type="checkbox" data-action="forcefail"' + (S.forceFail ? ' checked' : '') + '> Make the next renegotiation run fail</label>' +
    '<button class="btn sm" style="width:100%" data-action="dup">Simulate duplicate execution submit</button>' +
    '<button class="btn sm" style="width:100%" data-action="reset">Reset scenario</button></div>' +
    (S.opsLog && S.opsLog.length ? '<div class="tiny mono" style="margin-top:8px;color:#aab3d6">ops log: ' + esc(S.opsLog.slice(-2).join(' | ')) + '</div>' : '') + '</aside>';
}

function toastHtml() { return UI.toast ? '<div class="toast' + (UI.toast.ok ? '' : ' bad') + '" role="status">' + esc(UI.toast.msg) + '</div>' : ''; }
function notify(res) { if (!res) return; UI.toast = res; clearTimeout(notify.t); notify.t = setTimeout(function () { UI.toast = null; render(); }, 4200); }

window.render = function () {
  var a = document.activeElement, fid = a && a.id, sel = a && a.selectionStart;
  var r = route(), html = topbar(r);
  if (r === 'rooms') html += roomsPage();
  else if (r === 'brief') html += briefPage();
  else if (r === 'results') html += resultsPage();
  else if (r === 'timeline') html += timelinePage();
  else html += '<div class="page">' + roomHead('room') + banner() + '<div class="grid3"><div class="col-l">' + leftCol() + '</div><div class="col-c">' + centerCol() + '</div><div class="col-r">' + rightCol() + '</div></div></div>';
  app.innerHTML = html + drawer() + modal() + toastHtml();
  markSeen();
  if (fid) { var el = document.getElementById(fid); if (el) { el.focus(); try { if (sel != null) el.setSelectionRange(sel, sel); } catch (e) {} } }
  if (UI.anchor) { var t = document.getElementById(UI.anchor); UI.anchor = null; if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
};

function jump(n) {
  S = freshState(); S.role = [null, 'finance', 'customer', 'finance', 'customer', 'customer'][n];
  FAST = true; CLOCK = Date.now() - 30 * 60000;
  if (n >= 2) confirmBrief('finance');
  if (n >= 3) { approve('customer'); approve('provider'); }
  if (n >= 4) setCap(480000);
  if (n >= 5) { answerRequest('customer', 'A', ''); approve('customer'); approve('provider'); approve('finance'); }
  FAST = false; CLOCK = null; UI.sel = null; UI.seen = {}; eventsFor(S.role).forEach(function (e) { UI.seen[e.id] = 1; });
  location.hash = n === 1 ? '#/room/brief' : n === 5 ? '#/room/results' : '#/room';
  notify({ ok: true, msg: 'Jumped to moment ' + n + '. Viewing as ' + ROLES[S.role].label + '.' }); commit();
}

document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-action]');
  if (!el) { var lk = e.target.closest('[data-anchor]'); if (lk && lk.dataset.anchor) UI.anchor = lk.dataset.anchor; return; }
  var a = el.dataset.action, res = null, role = S.role;
  if (a === 'role') { S.role = el.dataset.role; UI.sel = null; UI.modal = null; UI.toast = null; clearTimeout(notify.t); return commit(); } // 切换角色时清掉上一角色的提示，避免私密数值残留在他人视图
  else if (a === 'drawer') UI.drawer = !UI.drawer;
  else if (a === 'confirm-brief') res = confirmBrief(role);
  else if (a === 'draft') res = resolveDraft(el.dataset.id, el.dataset.acc === '1');
  else if (a === 'approve') res = approve(role);
  else if (a === 'open-reject') { UI.modal = 'reject'; UI.rejectReason = ''; UI.rejectTpl = ''; }
  else if (a === 'reject-confirm') { var why = [UI.rejectTpl, UI.rejectReason].filter(Boolean).join(': '); res = reject(role, why); if (res.ok) UI.modal = null; }
  else if (a === 'open-cap') { UI.modal = 'cap'; UI.capInput = String((capNow() - 20000) / 100); }
  else if (a === 'cap-confirm') { res = setCap(Math.round(parseFloat(UI.capInput) * 100)); if (res.ok) UI.modal = null; }
  else if (a === 'modal-close') UI.modal = null;
  else if (a === 'pick') UI.sel = el.dataset.opt;
  else if (a === 'answer') { res = answerRequest(role, UI.sel, UI.note.trim()); if (res.ok) { UI.sel = null; UI.note = ''; } }
  else if (a === 'retry-run') res = retryRun();
  else if (a === 'task') res = toggleTask(role, el.dataset.id);
  else if (a === 'tl') UI.tlFilter = el.dataset.f;
  else if (a === 'jump') return jump(+el.dataset.n);
  else if (a === 'forcefail') S.forceFail = el.checked;
  else if (a === 'dup') res = duplicateSubmit();
  else if (a === 'cut') { S.role = 'finance'; res = setCap(480000); location.hash = '#/room'; }
  else if (a === 'reset') { S = freshState(); UI.seen = {}; UI.sel = null; location.hash = '#/rooms'; res = { ok: true, msg: 'Scenario reset.' }; }
  notify(res); commit();
});
document.addEventListener('input', function (e) {
  var b = e.target.dataset && e.target.dataset.bind; if (!b) return;
  UI[b] = e.target.value;
  if (b === 'capInput') { var pv = document.getElementById('cap-preview'); if (pv) pv.innerHTML = capPreview(UI.capInput); }
});
document.addEventListener('change', function (e) { var b = e.target.dataset && e.target.dataset.bind; if (b) UI[b] = e.target.value; });
window.addEventListener('hashchange', function () { render(); if (!UI.anchor) window.scrollTo(0, 0); });

load(); eventsFor(S.role).forEach(function (ev2) { UI.seen[ev2.id] = 1; }); render();

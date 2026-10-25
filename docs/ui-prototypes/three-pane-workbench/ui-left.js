/* ui-left.js —— 左栏：我的简报与约束（私密区）+ 我对他人披露了什么 */
function leftCol() {
  var r = S.role, b = BRIEFS[r], st = S.briefs[r];
  var head = '<div class="panel-h"><h2>My brief &amp; constraints</h2>' + privTag() + '</div>';
  var status = st.v ? '<div class="small">' + chip('Brief v' + st.v + ' confirmed', 'ok') + ' <span class="muted">' + timeStr(st.at) + '</span></div>'
    : '<div class="small">' + chip('Not confirmed', 'warn') + ' <a href="#/room/brief">Review and confirm</a></div>';
  var items = b.items.map(function (it) {
    return '<div class="bitem"><div class="row between"><span class="k">' + esc(it.kind) + '</span>' +
      (it.vis === 'private' ? '<span class="privtag">Private</span>' : '<span class="sharedtag">Shared with room</span>') + '</div>' +
      '<div>' + esc(it.text) + '</div></div>';
  }).join('');
  var html = '<section class="panel privzone" aria-labelledby="lh">' + head.replace('<h2>', '<h2 id="lh">') +
    '<div class="small muted" style="margin:-4px 0 8px">Goal: ' + esc(b.goal) + '</div>' + status + '<div style="margin-top:8px">' + items + '</div>' +
    '<div class="tiny muted" style="margin-top:8px">Your agent negotiates with these. Private items are checked by code; other people only see pass/fail where a disclosure rule allows.</div></section>';
  if (r === 'finance') html += budgetPanel();
  if (r === 'provider') html += quotesPanel();
  html += disclosedPanel();
  return html;
}

function budgetPanel() {
  var cap = capNow(), p = current(), add = p && !S.execution ? p.cost : (S.execution ? S.execution.amount : 0);
  var pct = function (c) { return Math.min(100, c / 550000 * 100); };
  var hist = S.constraints.slice().reverse().map(function (c) {
    return '<div class="apprrow"><span><span class="vchip">v' + c.v + '</span> cap ' + money(c.cap) + '</span><span class="muted small">' + timeStr(c.at) + '</span></div>';
  }).join('');
  var canChange = !S.execution;
  return '<section class="panel privzone" aria-labelledby="bh"><div class="panel-h"><h2 id="bh">Budget</h2>' + privTag('Finance only') + '</div>' +
    '<div class="kpi"><div><span class="small muted">Cap</span><b>' + money(cap) + '</b></div><div><span class="small muted">Committed</span><b>' + money(COMMITTED) + '</b></div><div><span class="small muted">Headroom</span><b>' + money(cap - COMMITTED) + '</b></div></div>' +
    '<div style="margin:12px 0 4px" class="bar" role="img" aria-label="Committed ' + money(COMMITTED) + ', this proposal ' + money(add) + ', cap ' + money(cap) + '">' +
    '<i class="cm" style="width:' + pct(COMMITTED) + '%"></i><i class="nw" style="left:' + pct(COMMITTED) + '%;width:' + (pct(COMMITTED + add) - pct(COMMITTED)) + '%"></i><span class="capmark" style="left:' + pct(cap) + '%"></span></div>' +
    '<div class="tiny muted">Grey: committed · Blue: ' + (p ? 'proposal v' + p.v : 'no proposal') + ' · Red line: cap</div>' +
    '<div class="actions" style="margin-top:10px"><button class="btn danger" data-action="open-cap"' + (canChange ? '' : ' disabled') + '>Lower budget cap…</button>' +
    '<span class="reason">' + (canChange ? 'Creates constraints v' + (S.cv + 1) + ' and re-checks the current proposal.' : 'Room is executed.') + '</span></div>' +
    '<h3 style="margin-top:12px">Constraint history</h3>' + hist + '</section>';
}

function quotesPanel() {
  var cited = {}; S.proposals.forEach(function (p) { cited[p.offer] = (cited[p.offer] || []).concat('v' + p.v); });
  var rows = BRIEFS.provider.offers.map(function (id) {
    var o = OFFERS[id];
    return '<div class="bitem"><div class="row between"><b>' + o.id + ' v' + o.v + ' · ' + esc(o.label) + '</b>' + (cited[id] ? '<span class="sharedtag">Cited by ' + cited[id].join(', ') + '</span>' : '<span class="privtag">Price private</span>') + '</div>' +
      '<div class="small">' + esc(scopeNames(o.scope)) + '</div><div class="small muted">' + money(o.cost) + ' · delivery ' + dateStr(o.date) + ' · confirmed</div></div>';
  }).join('');
  return '<section class="panel privzone"><div class="panel-h"><h2>My confirmed quotes</h2>' + privTag('Provider only') + '</div>' + rows +
    '<div class="tiny muted" style="margin-top:6px">Agents may only propose terms that match a confirmed quote. A quote’s price becomes visible to the room once a proposal cites it.</div></section>';
}

function disclosedPanel() {
  var r = S.role, shared = BRIEFS[r].items.filter(function (i) { return i.vis === 'shared'; });
  var extra = r === 'finance' ? '<li>Budget check result only (pass/fail). Cap and committed amounts are not shared.</li>'
    : r === 'customer' ? '<li>Delivery-limit check result only (pass/fail). Your latest date is not shared.</li>'
    : '<li>Prices of quotes cited by a proposal. Uncited quotes and capacity stay private.</li>';
  var others = ROLE_KEYS.filter(function (x) { return x !== r; }).map(function (x) {
    var st = S.briefs[x];
    return '<div class="apprrow"><span>' + roleTag(x) + '</span><span class="small muted">' + (st.v ? 'brief v' + st.v + ' confirmed ' + timeStr(st.at) : 'not confirmed yet') + '</span></div>';
  }).join('');
  return '<section class="panel"><div class="panel-h"><h2>What others can see from you</h2></div><ul class="small" style="margin:0;padding-left:18px">' +
    shared.map(function (i) { return '<li>' + esc(i.text) + '</li>'; }).join('') + extra + '</ul>' +
    '<h3 style="margin-top:12px">Other participants</h3>' + others + '<div class="tiny muted" style="margin-top:6px">You see their progress, never their private brief.</div></section>';
}

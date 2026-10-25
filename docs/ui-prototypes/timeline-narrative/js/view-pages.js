// 其余页面：房间列表、我的私密简报、执行记录（含追溯链与事件日志）。
(function () {
  const S = SFM.S; const P = SFM.PEOPLE; const M = SFM.money; const E = SFM.esc;

  function yourTurn(me) {
    const v = S.current;
    if (S.stage === 'briefs' && me === 'finance') return 'Your brief is not confirmed';
    if ((S.stage === 'approval' || S.stage === 'approval2') && SFM.decisionFor(me, v).state !== 'approved') return 'Your approval is needed';
    if (S.stage === 'awaiting_tradeoff' && me === 'customer') return 'A decision is requested from you';
    if (S.stage === 'run_failed') return 'Agent round failed · retry available';
    if (S.stage === 'executed') {
      const n = S.exec.tasks.filter(function (t) { return t.role === me && !S.tasksDone[t.id]; }).length;
      if (n) return n + ' open task' + (n > 1 ? 's' : '');
    }
    return '';
  }

  SFM.roomsPage = function () {
    const me = S.role; const last = S.events.filter(function (e) { return e.vis === 'room' || e.vis === me; }).slice(-1)[0];
    const turn = yourTurn(me);
    return '<section class="page-head"><h1>Rooms</h1><p class="muted">Signed in as ' + P[me].name + ' · ' + P[me].title + ', ' + P[me].org + ' <span class="tag proto">prototype role switch</span></p></section>' +
      '<div class="room-list">' +
      '<a class="card room-card" href="#/room/scope-change"><div class="cur-top"><h2>Loyalty launch scope change</h2>' + SFM.pill(SFM.STAGE[S.stage]) + '</div>' +
      '<p class="muted">Agree on scope, price and delivery for the loyalty-program change request.</p>' +
      '<p class="ver">Proposal v' + (S.current || '–') + ' · Constraints v' + S.cv + ' · 3 participants <span class="tag sim">Simulated</span></p>' +
      (turn ? '<p class="turn">● ' + E(turn) + '</p>' : '<p class="muted small">Nothing needs you right now.</p>') +
      '<p class="small latest"><span class="muted">Latest: </span>' + E(SFM.describe(last, me).title) + ' · ' + E(last.time) + '</p></a>' +
      SFM.OTHER_ROOMS.map(function (r) {
        return '<div class="card room-card off" aria-disabled="true"><div class="cur-top"><h2>' + E(r.title) + '</h2>' + SFM.pill([r.status, r.statusKind]) + '</div>' +
          '<p class="muted">' + E(r.goal) + '</p><p class="ver">' + E(r.meta) + ' <span class="tag sim">Simulated</span></p><p class="small muted">Not part of this prototype.</p></div>';
      }).join('') +
      '<div class="card room-card new"><h2>Start a room</h2><p class="muted small">Name the shared goal and pick a scenario. Each participant then joins and writes a private brief. Budget figures are entered by finance in their own brief, not here.</p><button class="btn" disabled>New room (not in prototype)</button></div></div>';
  };

  SFM.briefPage = function () {
    const me = S.role; const b = SFM.BRIEFS[me]; const st = S.briefs[me];
    const confirmed = !!st.v;
    let main = '<section class="card"><div class="cur-top"><h2>My private brief</h2>' +
      (confirmed ? SFM.pill(['Confirmed v' + st.v + ' · ' + st.at, 'ok']) : SFM.pill(['Draft · not confirmed', 'ask'])) + '</div>' +
      '<p><b>Goal:</b> ' + E(b.goal) + '</p><ul class="brief-items">' + b.items.map(function (i) {
        return '<li><span class="kind">' + E(i.kind) + '</span><span class="txt">' + E(i.text) + '</span><span class="tag ' + (i.share ? 'shared' : 'priv') + '">' + (i.share ? 'Shared with room' : 'Private') + '</span></li>';
      }).join('') + '</ul>';
    if (b.quotes) {
      main += '<h3>Confirmed quotes <span class="muted small">(sources for every price and date)</span></h3><table class="terms quotes"><tr><th>Quote</th><th>Scope</th><th>Price</th><th>Delivery</th></tr>' +
        b.quotes.map(function (k) { const q = SFM.QUOTES[k]; return '<tr><td>' + k + '<br><span class="muted small">' + E(q.label) + '</span></td><td>' + E(SFM.itemList(q.items)) + '</td><td>' + M(q.cents) + '</td><td>' + SFM.day(q.date) + '</td></tr>'; }).join('') +
        '</table><p class="small muted">A quote price becomes visible to the room only when a proposal cites it. Changing a quote creates a new version and re-checks open proposals.</p>';
    }
    if (me === 'customer' && S.deadline !== SFM.DEADLINE) main += '<div class="alert warn">You moved your first-delivery deadline to ' + SFM.day(S.deadline) + ' when answering the trade-off request (constraints v3). The original value stays in history.</div>';
    if (me === 'finance' && S.cv > 1) main += '<div class="alert warn">You lowered the cap to ' + M(S.cap) + ' (constraints v2). Brief v1 still shows the value you confirmed at the time.</div>';
    main += confirmed ? '<div class="row"><button class="btn" disabled>Edit (creates v' + (st.v + 1) + ')</button></div><p class="small muted">Editing is not part of this prototype. In the product, changing a hard constraint raises the constraints version and asks for fresh approvals.</p>' :
      '<div class="row"><button class="btn primary" data-act="confirm-brief">Confirm brief v1</button></div><p class="small muted">Until you confirm, your agent cannot use this brief and negotiation does not start. Unconfirmed extractions never count.</p>';
    main += '</section><section class="card"><h2>Extract from pasted text</h2><textarea disabled rows="3" aria-label="Paste text to extract">Paste an email or notes. Your agent drafts brief items, each linked to the sentence it came from.</textarea><p class="small muted">Every extracted item needs your confirmation before it counts. (Not interactive in this prototype.)</p></section>';

    const shared = b.items.filter(function (i) { return i.share; });
    let side = '<section class="card"><h2>What the room can see from you</h2><ul class="brief-mini">' + shared.map(function (i) { return '<li>' + E(i.text) + '</li>'; }).join('') + '</ul>';
    if (me === 'finance') side += '<p class="small">Derived and shared: <b>' + M(S.cap - SFM.BUDGET.committed) + ' available</b> for this change. The cap and committed totals stay private.</p>';
    if (me === 'provider') side += '<p class="small">Cited so far: ' + (Object.keys(S.proposals).map(function (k) { return S.proposals[k].quote; }).join(', ') || 'none') + '.</p>';
    side += '</section><section class="card"><h2>Other participants</h2><ul class="plist">' + SFM.ROLES.filter(function (r) { return r !== me; }).map(function (r) {
      const s = S.briefs[r];
      return '<li><b>' + P[r].name + '</b> <span class="muted small">' + SFM.ROLE_LABEL[r] + '</span><br><span class="small">' + (s.v ? 'Brief v' + s.v + ' confirmed · ' + s.at : 'Brief not confirmed yet') + '</span></li>';
    }).join('') + '</ul><p class="small muted">You never see another participant\'s private items, only what they chose to share.</p></section>' +
      '<section class="card"><h2>What your agent receives</h2><ul class="small"><li>This brief (all items, private ones included)</li><li>Items others shared with the room</li><li>Rules-check results, already filtered for you</li></ul><p class="small muted">Never: anyone else\'s private brief. Your agent can propose and recommend; it cannot approve for you.</p></section>';
    return SFM.roomHeader('brief') + '<div class="two-col">' + '<div>' + main + '</div><div>' + side + '</div></div>';
  };

})();

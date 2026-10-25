/* views-ledger.js — 账本（约束历史 + 承诺分录 + finance 改上限）、执行结果、事件时间线。 */
(function () {
  const F = window.SFM, E = window.ENG, U = window.UI, esc = F.esc;
  const scopeTxt = (s) => s.map((k) => F.SCOPE[k].label).join(', ');

  // ---------- 账本 ----------
  function ledger(role, flash) {
    const S = E.S, acc = F.budgetAccess(role), c = F.curC(S);
    const hist = '<section class="card"><h2>Constraints history</h2><div class="scroll"><table class="ledger"><thead><tr><th>Version</th>' + (acc === 'limit_only' ? '' : '<th class="r">Cap</th>') + '<th>Set by</th>' + (acc === 'full' ? '<th>Reason (private)</th>' : '') + '<th>When</th></tr></thead><tbody>' +
      S.constraints.slice().reverse().map((x) => '<tr class="' + (x === c ? 'cur' : 'struck') + '"><td>v' + x.v + (x === c ? ' <span class="badge info">current</span>' : '') + '</td>' + (acc === 'limit_only' ? '' : '<td class="r num">' + F.money(x.capCents) + '</td>') + '<td>Finance</td>' + (acc === 'full' ? '<td class="small">' + esc(x.reason) + '</td>' : '') + '<td class="small">' + F.fmtTime(x.at) + '</td></tr>').join('') +
      '</tbody></table></div>' + (acc === 'limit_only' ? '<p class="why">Cap amounts are private to Finance. You see that a new version exists, which is enough to know approvals must be renewed.</p>' : '<p class="why">Append-only. Older versions are kept; approvals reference the version they were given under.</p>') + '</section>';
    const entries = acc === 'limit_only' ? '<section class="card"><h2>Commitment entries</h2><p class="muted">Ledger entries are private to Finance and Customer. Your change order and its amount appear in Results once executed.</p></section>' :
      '<section class="card"><h2>Commitment entries</h2><div class="scroll"><table class="ledger"><thead><tr><th>Entry</th><th>Description</th><th class="r">Amount</th><th>Source</th></tr></thead><tbody>' +
      S.ledger.map((l) => '<tr><td class="num">' + l.id + '</td><td>' + esc(l.label) + '</td><td class="r num">' + F.money(l.cents) + '</td><td class="small num">' + esc(l.source) + '</td></tr>').join('') +
      '<tr><td></td><td><strong>Total committed</strong></td><td class="r num"><strong>' + F.money(F.committed(S)) + '</strong></td><td></td></tr></tbody></table></div><p class="why">Entries are written only by execution, once per operation ID.</p></section>';
    let ctl = '';
    if (role === 'finance') {
      const p = E.latest();
      ctl = '<section class="card attn" aria-labelledby="cap-h"><h2 id="cap-h">Change budget cap</h2>' + (S.execution ? '<p class="muted">The room is closed; later budget changes do not reopen it.</p>' :
        '<div class="pick"><label>New cap <input id="capInput" type="number" step="100" min="0" value="' + (c.capCents === 500000 ? 4800 : c.capCents / 100) + '" style="width:110px"></label>' +
        '<label>Reason <select id="capReason"><option>Q4 reforecast</option><option>Spending freeze</option><option>Other</option></select></label></div>' +
        '<div class="btnrow" style="margin-top:0"><button class="btn warnbtn" data-act="cap-submit">Apply as constraints v' + (c.v + 1) + '</button></div>' +
        '<p class="why">Creates constraints v' + (c.v + 1) + '. ' + (p ? 'Existing approvals on proposal v' + p.v + ' become stale. If proposal v' + p.v + ' no longer fits, re-negotiation starts automatically. ' : '') + 'The cap cannot go below committed (' + F.money(F.committed(S)) + '). The reason stays private to you.</p><p id="capErr" class="why" style="color:var(--danger)"></p>') + '</section>';
    }
    return '<div class="grid"><div class="stack">' + hist + entries + '</div><div class="stack">' + ctl + U.ledgerPanel(role, flash) + '</div></div>';
  }

  // ---------- 执行结果 ----------
  function results(role) {
    const S = E.S, x = S.execution, acc = F.budgetAccess(role);
    if (!x) {
      const p = E.latest(), bl = [];
      if (!p) bl.push('No proposal yet.');
      else {
        E.evalP(p).filter((c) => !c.pass).forEach((c) => bl.push('v' + p.v + ': ' + F.checkText(role, c)));
        F.ROLE_KEYS.forEach((r) => { const d = E.decision(r, p); if (d !== 'approved') bl.push(U.R(r) + ' approval: ' + d); });
      }
      if (E.openRequest()) bl.push('Open tradeoff request for ' + U.R(E.openRequest().target));
      if (E.activeRun()) bl.push('Agent run #' + E.activeRun().n + ' in progress');
      return '<section class="card"><h2>No executed agreement yet</h2><p>Execution happens automatically, once, when every required person approves the same version under the current constraints.</p><ul>' + bl.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul><button class="btn secondary" data-act="go:work">Back to workbench</button></section>';
    }
    const p = E.getP(x.pv);
    const used = S.decisions.filter((d) => d.pv === x.pv && d.cv === x.cv && d.kind === 'approve');
    const older = S.decisions.filter((d) => !used.includes(d));
    const co = '<section class="card ok"><div class="cardhead"><h2>Change order ' + x.changeOrder + '</h2><span class="badge ok">Executed · simulated</span></div>' +
      '<dl class="terms"><dt>Based on</dt><dd>Proposal v' + x.pv + ' · constraints v' + x.cv + ' · offer ' + p.offerId + ' v1</dd><dt>Scope</dt><dd>' + scopeTxt(p.scope) + '</dd><dt>Deferred</dt><dd>' + (p.deferred.length ? scopeTxt(p.deferred) : 'Nothing') + '</dd>' +
      '<dt>Amount</dt><dd class="num">' + F.money(x.cents) + '</dd><dt>Delivery</dt><dd>' + F.fmtDate(p.date) + '</dd><dt>Recorded</dt><dd>' + F.fmtTime(x.at) + '</dd><dt>Operation ID</dt><dd class="num small">' + x.opId + '</dd></dl>' +
      '<p class="why">An internal record only. No payment, transfer, or e-signature happens. Duplicate execution requests reuse this operation ID and are ignored' + (S.dupAttempts ? ' (' + S.dupAttempts + ' ignored so far)' : '') + '.</p></section>';
    const cm = '<section class="card"><h2>Budget commitment CMT-0002</h2>' + (acc === 'limit_only' ? '<p>Commitment recorded for <span class="num">' + F.money(x.cents) + '</span> (your offer price). Budget totals are private to Finance.</p>' :
      '<table class="ledger"><tbody><tr><td>Cap at execution</td><td class="r num">' + F.money(x.cap) + '</td></tr><tr><td>Committed before</td><td class="r num">' + F.money(x.before) + '</td></tr><tr><td>This commitment</td><td class="r num">+' + F.money(x.cents) + '</td></tr><tr><td><strong>Committed after</strong></td><td class="r num"><strong>' + F.money(x.after) + '</strong></td></tr><tr><td>Headroom left</td><td class="r num">' + F.money(x.cap - x.after) + '</td></tr></tbody></table><p class="why">Read from the execution snapshot, not recomputed.</p>') + '</section>';
    const tasks = '<section class="card"><h2>Tasks</h2><ul class="checks">' + x.tasks.map((t) => '<li><input type="checkbox" data-act="task:' + t.id + '"' + (t.done ? ' checked' : '') + (t.role !== role ? ' disabled title="Only the assignee can update this task"' : '') + '> <span>' + esc(t.text) + ' <span class="badge">' + U.R(t.role) + '</span> <span class="small muted">due ' + F.fmtDate(t.due) + '</span></span></li>').join('') + '</ul><p class="why">Only the assignee can tick a task.</p></section>';
    const rec = '<section class="card"><h2>Approval record</h2><ul class="checks">' + used.map((d) => '<li><span class="badge ok">Used for execution</span> ' + U.R(d.role) + ' approved v' + d.pv + ' under constraints v' + d.cv + '</li>').join('') +
      older.slice().reverse().map((d) => '<li><span class="badge">' + (d.cv !== x.cv ? 'No longer applies' : 'Superseded') + '</span> ' + U.R(d.role) + ' ' + ({ approve: 'approved', reject: 'rejected', withdraw: 'withdrew on' })[d.kind] + ' v' + d.pv + ' under constraints v' + d.cv + '</li>').join('') + '</ul><p class="why">Every decision is kept, including stale approvals.</p></section>';
    return '<div class="grid"><div class="stack">' + co + tasks + '</div><div class="stack">' + cm + rec + '</div></div>';
  }

  // ---------- 时间线 ----------
  function timeline(role) {
    const S = E.S, f = S.timelineFilter;
    const evs = E.visibleEvents(role).filter((e) => f === 'all' || (f === 'private' ? e.aud === role : e.aud === 'room'));
    const fb = (k, l) => '<button class="btn ' + (f === k ? '' : 'secondary') + '" data-act="tl:' + k + '">' + l + '</button>';
    return '<section class="card"><div class="cardhead"><h2>Event timeline</h2><div class="btnrow" style="margin:0">' + fb('all', 'All') + fb('room', 'Room-wide') + fb('private', 'Private to you') + '</div></div><ol class="tl">' +
      evs.map((e) => '<li><span class="t">' + F.fmtTime(e.at) + '</span><div>' + esc(E.evText(e, role)) + ' ' + (e.aud === role ? '<span class="badge private">Private to you</span>' : '') +
        '<div class="ty">' + e.type + ' · ' + (e.actor === role ? 'you' : e.actor) + '</div></div></li>').join('') + '</ol>' +
      '<p class="why">The log records actions, versions and outcomes, not hidden model reasoning. Each audience gets its own wording; amounts are left out for people without access.</p></section>';
  }

  window.VIEWS = Object.assign(window.VIEWS || {}, { ledger, results, timeline });
})();

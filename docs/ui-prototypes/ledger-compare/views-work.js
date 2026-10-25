/* views-work.js — 工作台（按角色的待办、约束变化横幅、代理回合、取舍请求、方案卡）与私密简报页。 */
(function () {
  const F = window.SFM, E = window.ENG, U = window.UI, esc = F.esc;

  function todos(role) {
    const S = E.S, out = [], p = E.latest(), q = E.openRequest();
    if (S.briefs[role].status === 'draft') out.push(['Confirm your private brief', 'go:brief', 'Open brief']);
    if (q && q.target === role) out.push(['Choose a tradeoff (' + q.options.length + ' options)', 'scroll:hr-h', 'Review']);
    const lr = S.runs[S.runs.length - 1];
    if (lr && lr.status === 'failed' && !lr.retried) out.push(['Agent run #' + lr.n + ' failed. Anyone can retry it.', 'retry:' + lr.id, 'Retry']);
    if (p && !S.execution && E.pStatus(p) === 'awaiting') {
      const st = E.decision(role, p);
      if (st === 'pending') out.push(['Approve or reject v' + p.v + ' under constraints v' + F.curC(S).v, 'scroll:prop-h', 'Review']);
      if (st === 'stale') out.push(['Your earlier approval no longer applies. Re-review v' + p.v + '.', 'scroll:prop-h', 'Review']);
    }
    if (S.execution) S.execution.tasks.filter((t) => t.role === role && !t.done).forEach((t) => out.push(['Task: ' + t.text + ' (due ' + F.fmtDate(t.due) + ')', 'go:results', 'Open']));
    return out;
  }

  function constraintBanner(role) {
    const S = E.S, c = F.curC(S);
    if (c.v < 2 || S.execution) return '';
    const prev = S.constraints[c.v - 2], blocked = S.proposals.filter((p) => F.checkTerms(S, p, prev).every((x) => x.pass) && !F.allPass(E.evalP(p)));
    const amt = role === 'provider' ? 'Finance changed the budget limit.' : 'Finance changed the cap ' + F.money(prev.capCents) + ' → ' + F.money(c.capCents) + '.';
    return '<section class="card alert" aria-labelledby="cc-h"><div class="cardhead"><h2 id="cc-h">Constraints changed: v' + prev.v + ' → v' + c.v + '</h2><span class="badge danger">Re-check required</span></div>' +
      '<p>' + amt + (blocked.length ? ' v' + blocked.map((p) => p.v).join(', v') + ' no longer fit' + (blocked.length > 1 ? '' : 's') + ' and cannot execute.' : '') +
      ' Approvals given under constraints v' + prev.v + ' are kept in history but no longer count.</p>' +
      '<div class="btnrow"><button class="btn secondary" data-act="go:compare">Compare versions</button><button class="btn secondary" data-act="go:ledger">Open ledger</button></div></section>';
  }

  function termsRows(role, p) {
    const S = E.S, acc = F.budgetAccess(role), b = F.checkTerms(S, p, F.curC(S))[0];
    const total = acc === 'limit_only' ? (b.pass ? 'Within finance limit' : 'Exceeds finance limit') : F.money(F.committed(S) + p.cents) + ' of ' + F.money(F.curC(S).capCents) + ' cap';
    return '<dl class="terms"><dt>Scope</dt><dd>' + p.scope.map((k) => F.SCOPE[k].label).join(', ') + '</dd>' +
      '<dt>Deferred</dt><dd>' + (p.deferred.length ? p.deferred.map((k) => F.SCOPE[k].label).join(', ') : 'Nothing') + '</dd>' +
      '<dt>Additional cost</dt><dd class="num">' + F.money(p.cents) + '</dd>' +
      '<dt>Delivery</dt><dd>' + F.fmtDate(p.date) + '</dd>' +
      '<dt>After commit</dt><dd class="num">' + total + '</dd></dl>';
  }

  function diffLine(p) {
    const prev = E.getP(p.v - 1); if (!prev) return '';
    const parts = [];
    if (p.cents !== prev.cents) parts.push('Cost ' + F.signed(p.cents - prev.cents));
    p.scope.filter((k) => !prev.scope.includes(k)).forEach((k) => parts.push('Adds ' + F.SCOPE[k].label));
    prev.scope.filter((k) => !p.scope.includes(k)).forEach((k) => parts.push('Defers ' + F.SCOPE[k].label));
    const dd = F.dayDiff(prev.date, p.date); if (dd) parts.push('Delivery ' + (dd > 0 ? '+' : '') + dd + ' days');
    if (p.createdUnderC !== prev.createdUnderC) parts.push('Constraints v' + prev.createdUnderC + ' → v' + p.createdUnderC);
    return '<p class="small"><strong>Changes from v' + prev.v + ':</strong> ' + (parts.join(' · ') || 'No term changes') + ' <a href="#/room/compare" data-act="cmp:' + prev.v + ':' + p.v + '">Compare side by side</a></p>';
  }

  function proposalCard(role) {
    const S = E.S, p = E.latest();
    if (!p) return '<section class="card"><h2 id="prop-h">No proposal yet</h2><p class="muted">Proposals appear after all three briefs are confirmed and an agent run completes. Agents can only cite confirmed offers.</p></section>';
    const st = E.pStatus(p), cv = F.curC(S).v, mine = E.decision(role, p), checksOk = F.allPass(E.evalP(p));
    const run = S.runs.find((r) => r.id === p.runId);
    let btns = '', why = '';
    if (st === 'executed') { why = 'Executed under constraints v' + S.execution.cv + '. See Results for the change order.'; btns = '<button class="btn secondary" data-act="go:results">Open results</button>'; }
    else if (!checksOk) { btns = '<button class="btn" disabled>Approve v' + p.v + '</button>'; why = 'Approval stays disabled while any check fails. A new version is being negotiated.'; }
    else if (mine === 'approved' || mine === 'rejected') { btns = '<button class="btn secondary" data-act="withdraw:' + p.v + '">Withdraw my decision</button>'; why = 'You ' + mine + ' v' + p.v + ' under constraints v' + cv + '.'; }
    else {
      btns = '<button class="btn" data-act="approve:' + p.v + '">Approve v' + p.v + ' under constraints v' + cv + '</button><button class="btn danger" data-act="reject:' + p.v + '">Reject</button>';
      why = (mine === 'stale' ? 'Terms are unchanged but constraints moved to v' + cv + ', so your earlier approval no longer counts. ' : '') + 'Your approval applies only to v' + p.v + ' under constraints v' + cv + '. Your agent\'s recommendation is not your approval.';
    }
    const creates = st === 'executed' ? '' : '<div class="creates"><strong>Approval by all three will create:</strong> 1 change order · 1 budget commitment of <span class="num">' + F.money(p.cents) + '</span> · ' + (p.scope.length + 2) + ' tasks. Written once, atomically. Internal records only.</div>';
    return '<section class="card ' + (st === 'blocked' ? 'alert' : st === 'executed' ? 'ok' : '') + '" aria-labelledby="prop-h"><div class="cardhead"><h2 id="prop-h">Proposal v' + p.v + '</h2>' + U.pBadge(p) + '</div>' +
      '<p class="small muted">Drafted by agent run #' + (run ? run.n : '?') + ' from confirmed offer ' + p.offerId + ' v1 · created under constraints v' + p.createdUnderC + ' · checked against constraints v' + cv + '</p>' +
      '<p>' + esc(p.summary) + '</p>' + termsRows(role, p) + diffLine(p) + '<h3 style="margin-top:12px">Rule checks (code, not the model)</h3>' + U.checksList(role, p) +
      creates + '<div class="btnrow">' + btns + '</div><p class="why">' + why + '</p></section>';
  }

  function sharedFacts(role) {
    const S = E.S;
    const items = [];
    F.ROLE_KEYS.filter((r) => r !== role).forEach((r) => {
      const b = S.briefs[r];
      if (b.status !== 'confirmed') { items.push('<li class="muted">' + U.R(r) + ': brief not confirmed yet</li>'); return; }
      b.items.filter((i) => i.share).forEach((i) => items.push('<li><strong>' + U.R(r) + ':</strong> ' + esc(i.text) + '</li>'));
    });
    if (role === 'customer') items.push('<li><strong>Finance:</strong> budget cap and committed figures (shared with you only)</li>');
    return '<section class="card" aria-labelledby="sf-h"><h2 id="sf-h">Shared facts</h2><ul style="margin:0;padding-left:18px;display:grid;gap:4px">' + items.join('') + '</ul><p class="why">Only items each person chose to share. Private constraints are still checked by code; you see pass / fail, not the value.</p></section>';
  }

  function workbench(role, flash) {
    const S = E.S, t = todos(role);
    const runs = S.runs.slice().reverse();
    const top = runs.find((r) => ['queued', 'running'].includes(r.status)) || (runs[0] && ['failed', 'discarded'].includes(runs[0].status) ? runs[0] : null);
    const done = runs.filter((r) => r !== top);
    const left = '<section class="card" aria-labelledby="todo-h"><h2 id="todo-h">Decisions needed from you</h2><ul class="todo">' +
      (t.length ? t.map(([txt, act, lbl]) => '<li><span>' + esc(txt) + '</span><button class="btn secondary" data-act="' + act + '">' + lbl + '</button></li>').join('') : '<li class="none">Nothing right now. You are waiting on other participants.</li>') + '</ul></section>' +
      constraintBanner(role) + U.runCard(top, role) + U.requestCard(E.openRequest(), role) + proposalCard(role) + done.map((r) => U.runCard(r, role)).join('');
    const right = U.ledgerPanel(role, flash) + U.approvalsPanel(role, E.latest()) + sharedFacts(role);
    return '<div class="grid"><div class="stack">' + left + '</div><div class="stack">' + right + '</div></div>';
  }

  window.VIEWS = Object.assign(window.VIEWS || {}, { workbench, todos });
})();

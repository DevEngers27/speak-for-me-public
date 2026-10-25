/* views-compare.js — 版本并排对比与“方案 × 约束版本”可执行性矩阵。 */
(function () {
  const F = window.SFM, E = window.ENG, U = window.UI, esc = F.esc;
  const scopeTxt = (s) => s.map((k) => F.SCOPE[k].label).join(', ');

  // ---------- 版本对比 ----------
  function compare(role) {
    const S = E.S, ps = S.proposals;
    if (ps.length < 2) return '<section class="card"><h2>Compare versions</h2><p class="muted">At least two proposal versions are needed. Versions appear after an agent run completes.</p></section>' + matrix(role);
    const b = E.getP(S.compare.b) || ps[ps.length - 1];
    const a = E.getP(S.compare.a) || ps[ps.indexOf(b) - 1] || ps[0];
    const opt = (sel, which) => '<select data-cmp="' + which + '" aria-label="Version ' + which.toUpperCase() + '">' + ps.map((p) => '<option value="' + p.v + '"' + (p === sel ? ' selected' : '') + '>v' + p.v + ' · ' + F.money(p.cents) + '</option>').join('') + '</select>';
    const acc = F.budgetAccess(role), c = F.curC(S);
    const after = (p) => acc === 'limit_only' ? (F.checkTerms(S, p, c)[0].pass ? 'Within finance limit' : 'Exceeds finance limit') : F.money((S.execution ? S.execution.before : F.committed(S)) + p.cents) + ' of ' + F.money(c.capCents);
    const scopeB = F.SCOPE_ORDER.filter((k) => a.scope.includes(k) || b.scope.includes(k)).map((k) =>
      b.scope.includes(k) && !a.scope.includes(k) ? '<span class="diff-add">+ ' + F.SCOPE[k].label + '</span>' :
      !b.scope.includes(k) ? '<span class="diff-del">' + F.SCOPE[k].label + '</span> <span class="diff-def">(deferred)</span>' : F.SCOPE[k].label).join('<br>');
    const dd = F.dayDiff(a.date, b.date), dc = b.cents - a.cents;
    const checks = (p) => { const r = E.evalP(p), n = r.filter((x) => x.pass).length; return '<span class="badge ' + (n === r.length ? 'ok' : 'danger') + '">' + n + ' / ' + r.length + ' pass</span>' + r.filter((x) => !x.pass).map((x) => '<div class="small">' + esc(F.checkText(role, x)) + '</div>').join(''); };
    const who = (p, fn) => F.ROLE_KEYS.map((r) => '<div class="small">' + U.R(r) + ': ' + fn(r, p) + '</div>').join('');
    const row = (h, fa, fb, changed) => '<tr><th class="rowh" scope="row">' + h + '</th><td>' + fa + '</td><td class="' + (changed ? 'delta' : '') + '">' + fb + '</td></tr>';
    const statusNote = (p) => { const st = E.pStatus(p); return st === 'superseded' && !F.allPass(E.evalP(p)) ? '<div class="small muted">Also fails current constraints v' + c.v + '</div>' : ''; };
    const body =
      row('Status', U.pBadge(a) + statusNote(a), U.pBadge(b) + statusNote(b), true) +
      row('Source', 'Run #' + runN(a) + ' · offer ' + a.offerId, 'Run #' + runN(b) + ' · offer ' + b.offerId, a.offerId !== b.offerId) +
      row('Created under', 'constraints v' + a.createdUnderC, 'constraints v' + b.createdUnderC, a.createdUnderC !== b.createdUnderC) +
      row('Scope', scopeTxt(a.scope), scopeB, scopeTxt(a.scope) !== scopeTxt(b.scope)) +
      row('Deferred', a.deferred.length ? scopeTxt(a.deferred) : 'Nothing', b.deferred.length ? scopeTxt(b.deferred) : 'Nothing', scopeTxt(a.deferred) !== scopeTxt(b.deferred)) +
      row('Additional cost', '<span class="num">' + F.money(a.cents) + '</span>', '<span class="num">' + F.money(b.cents) + '</span> <span class="small ' + (dc > 0 ? 'diff-del' : 'diff-add') + '" style="text-decoration:none">' + (dc ? F.signed(dc) : '') + '</span>', dc !== 0) +
      row('After commit', '<span class="num">' + after(a) + '</span>', '<span class="num">' + after(b) + '</span>', false) +
      row('Delivery', F.fmtDate(a.date), F.fmtDate(b.date) + (dd ? ' <span class="small diff-def">' + (dd > 0 ? '+' : '') + dd + ' days</span>' : ''), dd !== 0) +
      row('Checks vs constraints v' + c.v, checks(a), checks(b), false) +
      row('Agent recommendations<div class="small muted">advisory only</div>', who(a, (r, p) => U.recBadge(p.recs[r])), who(b, (r, p) => U.recBadge(p.recs[r])), false) +
      row('Human approvals<div class="small muted">bind version + constraints</div>', who(a, (r, p) => U.dBadge(E.decision(r, p))), who(b, (r, p) => U.dBadge(E.decision(r, p))), false);
    return '<section class="card" aria-labelledby="cmp-h"><div class="cardhead"><h2 id="cmp-h">Compare versions</h2><span class="vchip">current constraints v' + c.v + '</span></div>' +
      '<div class="pick">' + opt(a, 'a') + '<span class="muted">vs</span>' + opt(b, 'b') + '<span class="small muted">Highlighted cells differ from the left version.</span></div>' +
      '<div class="scroll"><table class="cmp"><thead><tr><th class="rowh"></th><th>v' + a.v + '</th><th>v' + b.v + '</th></tr></thead><tbody>' + body + '</tbody></table></div></section>' + matrix(role);
  }
  const runN = (p) => { const r = E.S.runs.find((x) => x.id === p.runId); return r ? r.n : '?'; };

  // 方案 × 约束版本矩阵：同一条款在不同约束版本下是否可执行（派生，不复制提案）
  function matrix(role) {
    const S = E.S; if (!S.proposals.length) return '';
    const head = S.constraints.map((c) => '<th class="r">constraints v' + c.v + (role === 'provider' ? '' : '<div class="small muted num">cap ' + F.money(c.capCents) + '</div>') + '</th>').join('');
    const rows = S.proposals.map((p) => '<tr' + (p === E.latest() ? ' class="cur" aria-current="true"' : '') + '><td>v' + p.v + '</td><td class="small">' + scopeTxt(p.scope) + '</td><td class="r num">' + F.money(p.cents) + '</td><td>' + F.fmtDate(p.date) + '</td>' +
      S.constraints.map((c) => { const ok = F.allPass(F.checkTerms(S, p, c)); return '<td class="r">' + (c.v < p.createdUnderC ? '<span class="muted">—</span>' : ok ? '<span class="badge ok">Fits</span>' : '<span class="badge danger">Blocked</span>'); }).join('') + '</tr>').join('');
    return '<section class="card" style="margin-top:16px"><h2>Fit by constraints version</h2><div class="scroll"><table class="ledger"><thead><tr><th>Version</th><th>Scope</th><th class="r">Cost</th><th>Delivery</th>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="why">Terms never change after a version is created. When constraints change, fit is recomputed; approvals bind to one column.</p></section>';
  }

  window.VIEWS = Object.assign(window.VIEWS || {}, { compare });
})();

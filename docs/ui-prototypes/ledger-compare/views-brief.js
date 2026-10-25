/* views-brief.js — 私密简报：条目、共享开关（确认前）、provider 报价与可见性、finance 预算披露、他方进度。 */
(function () {
  const F = window.SFM, E = window.ENG, U = window.UI, esc = F.esc;

  // ---------- 私密简报 ----------
  function brief(role) {
    const S = E.S, b = S.briefs[role], draft = b.status === 'draft';
    const rows = b.items.map((i) => '<tr><td><span class="badge ' + (i.kind === 'hard' ? 'danger' : 'info') + '">' + (i.kind === 'hard' ? 'Hard constraint' : 'Preference') + '</span></td><td>' + esc(i.text) + '</td><td>' +
      (draft ? '<label><input type="checkbox" data-act="share:' + i.id + '"' + (i.share ? ' checked' : '') + '> Share with room</label>' : (i.share ? '<span class="badge ok">Shared</span>' : '<span class="badge private">Private</span>')) + '</td></tr>').join('');
    let extra = '';
    if (role === 'provider') {
      const cited = S.proposals.map((p) => p.offerId);
      extra = '<h3 style="margin-top:16px">Confirmed offers (sources)</h3><div class="scroll"><table class="ledger"><thead><tr><th>Offer</th><th>Scope</th><th class="r">Price</th><th>Delivery</th><th>Visibility</th></tr></thead><tbody>' +
        Object.values(F.OFFERS).map((o) => '<tr><td>' + o.label + '<div class="small muted">' + o.id + ' v' + o.v + ' · confirmed</div></td><td class="small">' + o.scope.map((k) => F.SCOPE[k].label).join(', ') + '</td><td class="r num">' + F.money(o.cents) + '</td><td>' + F.fmtDate(o.date) + '</td><td>' +
          (cited.includes(o.id) ? '<span class="badge ok">Visible: cited by v' + S.proposals.find((p) => p.offerId === o.id).v + '</span>' : '<span class="badge private">Private until cited</span>') + '</td></tr>').join('') + '</tbody></table></div>';
    }
    if (role === 'finance') {
      const c = F.curC(S);
      extra = '<h3 style="margin-top:16px">Budget figures</h3><dl class="terms"><dt>Cap</dt><dd class="num">' + F.money(c.capCents) + ' <span class="small muted">constraints v' + c.v + '</span></dd><dt>Committed</dt><dd class="num">' + F.money(F.committed(S)) + ' <span class="small muted">from ledger</span></dd>' +
        '<dt>Disclosure</dt><dd><span class="badge ok">Shared with Customer</span> <span class="badge private">Hidden from Provider</span></dd></dl><p class="why">Change the cap from the Ledger tab. Every change creates a new constraints version.</p>';
    }
    const others = F.ROLE_KEYS.filter((r) => r !== role).map((r) => { const ob = S.briefs[r]; return '<li>' + U.R(r) + ': ' + (ob.status === 'confirmed' ? 'brief v' + ob.v + ' confirmed ' + F.fmtTime(ob.confirmedAt) : 'not confirmed yet') + '</li>'; }).join('');
    const sees = b.items.filter((i) => i.share).map((i) => '<li>' + esc(i.text) + '</li>').join('') +
      (role === 'provider' ? '<li>Offer price and date, once a proposal cites the offer</li>' : '') + (role === 'finance' ? '<li>Budget figures: Customer only</li>' : '');
    return '<div class="grid"><div class="stack"><section class="card ' + (draft ? 'attn' : '') + '" aria-labelledby="br-h"><div class="cardhead"><h2 id="br-h">My private brief</h2>' +
      (draft ? '<span class="badge warn">Draft · unconfirmed</span>' : '<span class="badge ok">v' + b.v + ' confirmed ' + F.fmtTime(b.confirmedAt) + '</span>') + '</div>' +
      (draft ? '<p class="small">Your agent extracted these items from your pasted notes (simulated). Nothing here is used until you confirm it.</p>' : '') +
      '<div class="scroll"><table class="ledger"><thead><tr><th>Type</th><th>Item</th><th>Visibility</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + extra +
      (draft ? '<div class="btnrow"><button class="btn" data-act="confirm-brief">Confirm brief v1</button></div><p class="why">Confirming lets your agent and the rule checks use these items. Changing a hard constraint later creates a new constraints version and voids existing approvals.</p>' : '<p class="why">Editing a confirmed brief creates v' + (b.v + 1) + ' (not modeled in this prototype).</p>') +
      '</section></div><div class="stack"><section class="card"><h2>What others can see</h2><ul style="margin:0;padding-left:18px">' + (sees || '<li class="muted">Nothing shared</li>') + '</ul><p class="why">Private items never leave the server in the real product. Your agent uses them; others see only check results.</p></section>' +
      '<section class="card"><h2>Other participants</h2><ul style="margin:0;padding-left:18px">' + others + '</ul><p class="why">You see brief status only, never contents.</p></section></div></div>';
  }

  window.VIEWS = Object.assign(window.VIEWS || {}, { brief });
})();

// 房间：概览、方案与版本、我的私密简报、预算（仅 finance）。
(function () {
  const V = window.V, esc = V.esc;

  function nowCard(P) {
    const need = P.inbox.needs[0];
    const texts = {
      brief: 'Waiting for every participant to confirm a private brief. Agents can’t start before that.',
      negotiating: 'Agents are negotiating within each person’s confirmed brief.',
      approval_v2: 'Proposal v2 passed every code check and is waiting for all three approvals.',
      renegotiating: 'The budget constraint changed. Agents are renegotiating under constraints v2.',
      tradeoff: 'Two confirmed options fit the new budget. Customer is choosing between date and scope.',
      formalizing: 'The provider agent is drafting v3 from Customer’s answer.',
      approval_v3: 'Proposal v3 passed every code check and is waiting for all three approvals.',
      executed: 'All approvals recorded. The change order, commitment and tasks were written once.'
    };
    if (P.lastRun && P.lastRun.status === 'failed') return `<div class="card"><h2>Now</h2><p class="muted" style="margin:6px 0 10px">The last agent run failed: ${esc(P.lastRun.error)} Proposals, approvals and constraints are unchanged.</p><button class="btn primary" data-act="retry">Retry run</button> <span class="faint">Any participant can retry.</span></div>`;
    return `<div class="card"><h2>Now</h2><p class="muted" style="margin:6px 0 10px">${esc(texts[P.stage])}</p>
      ${need ? `<div class="row"><a class="btn primary" href="${need.href}">${esc(need.cta)}</a><span class="faint">${esc(need.title)}</span></div>` : '<span class="faint">Nothing needs you right now.</span>'}</div>`;
  }

  function proposalMini(P) {
    const lv = P.latest;
    if (!lv) return '';
    const fails = lv.checks.filter(c => !c.ok);
    return `<div class="card"><div class="row between"><h3>Current: proposal v${lv.v} · ${esc(lv.label)}</h3>${V.statusBadge(lv.status)}</div>
      <dl class="terms"><dt>In scope</dt><dd>${V.list(lv.scope)}</dd><dt>Deferred</dt><dd>${V.list(lv.deferred)}</dd><dt>Cost · delivery</dt><dd>${esc(lv.price)} · ${esc(lv.delivery)}</dd>${lv.totalAfter ? `<dt>Total after</dt><dd>${esc(lv.totalAfter)} <span class="priv">Finance only</span></dd>` : ''}</dl>
      <div class="why">${fails.length ? `Blocked: ${fails.map(f => `<span class="code">${esc(f.code)}</span>`).join(', ')} under constraints v${P.cv}.` : `All ${lv.checks.length} code checks pass under constraints v${P.cv}.`} <a href="#/room/proposals">All versions</a></div></div>`;
  }

  V.roomOverview = (P) => {
    const lv = P.latest;
    let h = V.roomHead(P, 'overview') + V.constraintBanner(P);
    if (P.execution) h += `<div class="banner ok"><div><strong>Executed: change order ${esc(P.execution.co)} from proposal v${P.execution.v} · constraints v${P.execution.cv}.</strong><a href="#/room/results">See change order, commitment and tasks</a></div></div>`;
    h += `<div class="grid2"><div>${nowCard(P)}${proposalMini(P)}${V.runCard(P, true)}
      <details class="more"><summary>Learn more: agent messages (${P.runs.filter(r => r.status === 'succeeded').length ? 'shareable text' : 'none yet'})</summary><div>${V.transcript(P)}</div></details></div>
      <aside>${lv && lv.status !== 'superseded' ? V.approvalsCard(lv, P) : ''}
        <div class="card"><h3>Shared facts</h3><div class="faint">Only what each person chose to share.</div>
          ${P.sharedFacts.length ? P.sharedFacts.map(f => `<div class="line-item"><span>${esc(f.text)}</span><span class="faint">${esc(P.people[f.from].label)}</span></div>`).join('') : '<p class="faint">Nothing shared yet.</p>'}</div>
        <div class="card"><h3>Private briefs</h3><div class="faint">You see versions, never contents.</div>
          ${P.briefStatus.map(b => `<div class="line-item"><span>${esc(P.people[b.role].label)}${b.role === P.role ? ' (you)' : ''}</span>${b.v ? V.badge('Brief v' + b.v + ' confirmed', 'ok') : V.badge('Not confirmed', 'warn')}</div>`).join('')}</div>
      </aside></div>`;
    return h;
  };

  V.roomProposals = (P) => {
    let h = V.roomHead(P, 'proposals') + V.constraintBanner(P);
    if (!P.proposals.length) return h + `<div class="card empty">No proposals yet. ${P.lastRun && P.lastRun.status === 'running' ? 'Agents are working on the first one.' : ''}</div>`;
    const fin = P.role === 'finance';
    h += `<div class="card"><div class="row between"><h2>Compare versions</h2><span class="faint">Append-only: old versions and their checks stay visible.</span></div>
      <div class="scroll-x" style="margin-top:8px"><table class="cmp"><thead><tr><th>Version</th><th>Scope</th><th>Cost</th><th>Delivery</th>${fin ? '<th>Total after <span class="priv">Finance</span></th>' : '<th>Budget</th>'}<th>Status (constraints v${P.cv})</th></tr></thead><tbody>
      ${P.proposals.slice().reverse().map(p => `<tr ${p === P.latest ? 'aria-current="true"' : ''}><td><strong>v${p.v}</strong><div class="faint">from offer ${esc(p.offer)}</div></td>
        <td>${V.list(p.scope)}${p.deferred.length ? `<div class="faint">Deferred: ${esc(p.deferred.join(', '))}</div>` : ''}</td><td>${esc(p.price)}</td><td>${esc(p.delivery)}</td>
        <td>${fin ? esc(p.totalAfter) : (p.checks[0].ok ? 'Fits cap' : 'Over cap')}</td>
        <td>${V.statusBadge(p.status)}<div class="faint">${p.checks.filter(c => !c.ok).map(c => esc(c.code)).join(', ') || (p.status === 'superseded' ? 'Replaced by a later version' : 'All checks pass')}</div></td></tr>`).join('')}
      </tbody></table></div></div>`;
    h += P.proposals.slice().reverse().map(p => `<details class="more"><summary>v${p.v} · ${esc(p.label)} — checks and approvals</summary><div>
      ${V.checks(p.checks)}<div style="margin-top:10px">${p.approvals.map(a => `<div class="appr-row"><span>${esc(P.people[a.role].label)}</span><span>${a.agent ? V.agentChip('Agent: accept') : ''}</span>${V.humanBadge(a.human)}</div>`).join('')}</div></div></details>`).join('');
    return h;
  };

  V.roomBrief = (P) => {
    const b = P.brief;
    let h = V.roomHead(P, 'brief');
    if (P.role === 'finance' && !b.v) return h + `<div class="card"><h2>Your brief is not confirmed yet</h2><p class="muted">Your agent extracted items from your pasted text. Review them first.</p><a class="btn primary" href="#/decide/brief">Review brief</a></div>`;
    const mine = b.items.filter(i => i.status !== 'discarded');
    h += `<div class="grid2"><div><div class="card"><div class="row between"><h2>My private brief · v${b.v}</h2><span class="priv">Only you and your agent</span></div>
      <p class="muted">${esc(b.goal)}</p>
      ${mine.map(i => `<div class="brief-item"><div><div>${esc(i.text)}</div><div class="row" style="margin-top:4px">${V.badge(i.kind, 'neutral', 'nodot')}</div></div><div>${i.shared ? V.badge('Shared', 'info') : V.badge('Private', 'busy')}</div></div>`).join('')}
      <div class="row" style="margin-top:12px"><button class="btn" disabled>Edit brief</button><span class="why" style="margin:0">Editing isn’t in this prototype. Confirming a change creates a new constraints version.</span></div></div>`;
    if (b.offers) {
      h += `<div class="card"><div class="row between"><h2>My confirmed offers</h2><span class="priv">Private until used</span></div><p class="faint">${esc(b.offerNote)} Agents may only cite these; they can’t invent prices.</p>
        <div class="scroll-x"><table class="cmp"><thead><tr><th>Offer</th><th>Scope</th><th>Price</th><th>Delivery</th><th>Status</th></tr></thead><tbody>
        ${b.offers.map(o => `<tr><td><span class="mono">${esc(o.key)}</span><div class="faint">${esc(o.label)}</div></td><td>${esc(o.scopeN.join(', '))}</td><td>${esc(o.price)}</td><td>${esc(o.date)}</td><td>${V.badge('Confirmed', 'ok')}${P.proposals.some(p => p.offer === o.key) || (P.request && P.request.options.some(x => x.offer === o.key)) ? `<div class="faint">Disclosed (used)</div>` : ''}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    }
    h += `</div><aside><div class="card"><h3>What the room can see</h3>${mine.filter(i => i.shared).map(i => `<div class="line-item"><span>${esc(i.text)}</span></div>`).join('') || '<p class="faint">Nothing.</p>'}
      <p class="faint">Private items are used by your agent and by code checks. Others see only pass / fail results, never the values.</p></div>
      <div class="card"><h3>Other participants</h3>${P.briefStatus.filter(x => x.role !== P.role).map(x => `<div class="line-item"><span>${esc(P.people[x.role].label)}</span>${x.v ? V.badge('Brief v' + x.v, 'ok') : V.badge('Not confirmed', 'warn')}</div>`).join('')}<p class="faint">Their brief contents are never shown to you.</p></div></aside></div>`;
    return h;
  };

  V.roomBudget = (P) => {
    let h = V.roomHead(P, 'budget');
    if (P.role !== 'finance') return h + `<div class="card locked"><h2>Budget details are private to Finance</h2><p class="muted">You see whether each proposal fits the budget, never the amounts.</p></div>`;
    const b = P.budget; const can = P.stage === 'approval_v2';
    const capChanges = P.events.filter(e => e.type === 'constraints_changed');
    h += `<div class="grid2"><div><div class="card"><div class="row between"><h2>Budget constraint · constraints v${P.cv}</h2><span class="priv">Finance only</span></div>
      <dl class="terms"><dt>Budget cap</dt><dd><strong>${esc(b.cap)}</strong></dd><dt>Committed</dt><dd>${esc(b.committed)}</dd><dt>Headroom</dt><dd>${esc(b.remaining)}</dd></dl></div>
      <div class="card"><h2>Change the budget cap</h2><p class="muted" style="margin:6px 0 10px">A change creates a <strong>new constraints version</strong>. Approvals made under the old version stop applying, and any proposal that no longer fits is blocked automatically.</p>
        <div class="row"><label style="flex:1;min-width:140px">New cap (USD)<input type="number" id="newcap" value="4800" min="4000" step="50" ${can ? '' : 'disabled'}></label>
        <label style="flex:2;min-width:200px">Reason (kept in history)<input type="text" id="capreason" value="FY26 Q4 reforecast" ${can ? '' : 'disabled'}></label></div>
        <div class="row" style="margin-top:12px"><button class="btn primary" data-act="lowercap" ${can ? '' : 'disabled'}>Apply new cap</button>
        <span class="why" style="margin:0">${can ? 'v2 is awaiting approval — this is the demo moment.' : 'In this prototype the change is available while v2 awaits approval.'}</span></div></div></div>
      <aside><div class="card"><h3>Constraint history</h3>${capChanges.length ? capChanges.map(e => `<div class="line-item"><span>${esc(e.text)}</span><span class="faint">${esc(e.time)}</span></div>`).join('') : '<p class="faint">Constraints v1 since your brief was confirmed.</p>'}</div></aside></div>`;
    return h;
  };
})();

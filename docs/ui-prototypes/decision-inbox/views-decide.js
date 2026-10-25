// 决策页：确认简报、批准具体版本、回答取舍。每页只放做这个决定所需的信息，其余折叠在 "Learn more"。
(function () {
  const V = window.V, esc = V.esc;
  V.ui = V.ui || { pick: null, note: '' };

  const head = (kind, q, sub) => `<a href="#/inbox" class="faint">&larr; Inbox</a>
    <div class="kind" style="margin-top:10px;color:var(--ink-3)">${esc(kind)}</div>
    <div class="decision-q" style="margin:2px 0 6px">${esc(q)}</div><p class="muted" style="margin:0 0 18px">${sub}</p>`;
  const notYours = (txt) => `<div class="card locked"><h2>This decision isn’t yours</h2><p class="muted">${esc(txt)}</p><a class="btn" href="#/inbox">Back to inbox</a></div>`;

  // ---------- 1. 确认简报（finance） ----------
  V.decideBrief = (P) => {
    if (P.role !== 'finance') return notYours('Only Finance confirms Finance’s private brief. You will see which rules Finance chooses to share — never the brief itself.');
    const b = P.brief;
    if (b.v > 0) return head('Confirm · ' + P.room.title, 'Brief v1 confirmed', 'Your agent and the code checks now use these items.') + `<a class="btn" href="#/room/brief">Open my brief</a> <a class="btn" href="#/inbox">Back to inbox</a>`;
    const shared = b.items.filter(i => i.shared && i.status !== 'discarded');
    return head('Confirm · ' + P.room.title, 'Confirm what your agent may use', 'Your agent extracted these items from the text you pasted. <strong>Nothing is used by any agent or check until you confirm.</strong> Each item stays private unless you mark it Shared.') +
    `<div class="grid2"><div>
      <div class="card"><div class="row between"><h2>Extracted items</h2>${V.badge('Draft · not in effect', 'warn')}</div>
      ${b.items.map(i => `<div class="brief-item"><div><div>${esc(i.text)}</div><div class="row" style="margin-top:4px">${V.badge(i.kind, 'neutral', 'nodot')}${i.status === 'confirmed' ? V.badge('Confirmed', 'ok') : i.status === 'discarded' ? V.badge('Discarded', 'bad') : V.badge('Needs review', 'warn')}</div>
        <div class="src">From your text: “${esc(i.source)}”</div></div>
        <div class="stack" style="text-align:right">
          <div class="row" style="justify-content:flex-end"><button class="btn small" data-act="fitem" data-key="${i.key}" data-status="confirmed" ${i.status === 'confirmed' ? 'disabled' : ''}>Keep</button><button class="btn small danger" data-act="fitem" data-key="${i.key}" data-status="discarded" ${i.status === 'discarded' ? 'disabled' : ''}>Discard</button></div>
          <label class="faint"><input type="checkbox" data-act="fshare" data-key="${i.key}" ${i.shared ? 'checked' : ''}> Share with room</label></div></div>`).join('')}
      </div>
      <div class="human-box" style="margin-top:14px"><div class="lbl">Your decision</div>
        <p style="margin:6px 0 10px">Confirming creates <strong>brief v1</strong> and sets <strong>constraints v1</strong> for this room. Later changes create a new version and make approvals under the old one no longer apply.</p>
        <button class="btn primary" data-act="confirmbrief">Confirm brief v1</button>
        <div class="why">Items still marked “Needs review” are kept as shown. Cap and committed amounts must be kept — budget checks need them.</div></div>
    </div><aside>
      <div class="card"><h3>What others will see</h3>
        <ul class="plain" style="margin-top:8px">${shared.length ? shared.map(i => `<li class="line-item"><span>${esc(i.text)}</span>${V.badge('Shared', 'info')}</li>`).join('') : '<li class="faint">Nothing shared.</li>'}</ul>
        <p class="faint">Plus “Finance confirmed brief v1”. Private amounts are used by code checks; others see only pass / fail.</p></div>
      <details class="more"><summary>Your pasted text</summary><div><p class="muted" style="margin:0">${esc(b.pasted)}</p></div></details>
    </aside></div>`;
  };

  // ---------- 2. 批准具体版本 ----------
  function diff(P, lv) {
    const prev = P.proposals.find(p => p.v === lv.v - 1);
    if (!prev) return '<li class="faint">First proposal in this room.</li>';
    const out = [];
    if (prev.cents !== lv.cents) out.push(`Price ${esc(prev.price)} → ${esc(lv.price)}`);
    prev.scope.filter(s => !lv.scope.includes(s)).forEach(s => out.push(`${esc(s)}: ${lv.deferred.includes(s) ? 'deferred to a later phase' : 'removed'}`));
    lv.scope.filter(s => !prev.scope.includes(s)).forEach(s => out.push(`${esc(s)}: added`));
    if (prev.delivery !== lv.delivery) out.push(`Delivery ${esc(prev.delivery)} → ${esc(lv.delivery)}`);
    if (!out.length) out.push('No term changes');
    if (prev.cvAt !== lv.cvAt) out.push(`<span class="faint">Constraints v${prev.cvAt} → v${lv.cvAt} since v${prev.v} (not a term change)</span>`);
    return out.map(x => `<li style="padding:3px 0">${x}</li>`).join('');
  }

  function budgetPanel(P, lv) {
    if (!P.budget) return `<div class="card"><h3>Budget</h3>${V.checks([lv.checks[0]])}</div>`;
    const cap = P.budget.capC, com = P.budget.committedC, add = lv.cents, scale = Math.max(cap, com + add) * 1.04;
    const pct = x => (x / scale * 100).toFixed(2) + '%';
    const over = com + add > cap;
    return `<div class="card"><div class="row between"><h3>Budget impact</h3><span class="priv">Finance only</span></div>
      <div class="bar" role="img" aria-label="Committed ${esc(P.budget.committed)}, this proposal ${esc(lv.price)}, cap ${esc(P.budget.cap)}">
        <span class="c" style="width:${pct(com)}"></span><span class="p ${over ? 'over' : ''}" style="left:${pct(com)};width:${pct(add)}"></span><span class="cap" style="left:${pct(cap)}"></span></div>
      <dl class="terms"><dt>Committed</dt><dd>${esc(P.budget.committed)}</dd><dt>This version</dt><dd>${esc(lv.price)}</dd><dt>Total after</dt><dd><strong>${esc(lv.totalAfter)}</strong> of ${esc(P.budget.cap)} cap</dd></dl></div>`;
  }

  V.approvalsCard = (lv, P) => `<div class="card"><h3>Approvals for v${lv.v} · constraints v${P.cv}</h3>${lv.status === 'blocked' ? '<div class="faint">v' + lv.v + ' is blocked: open approval requests were withdrawn.</div>' : ''}
    <div style="margin-top:6px">${lv.approvals.map(a => `<div class="appr-row"><div class="row">${V.avatar(a.role, P)}<div><div>${esc(a.name)}</div><div class="faint">${esc(P.people[a.role].label)}</div></div></div>
      <div>${a.agent ? V.agentChip('Agent: accept') : '<span class="faint">No current rec.</span>'}</div><div>${lv.status === 'blocked' && a.human === 'pending' ? V.badge('Withdrawn', 'neutral') : V.humanBadge(a.human)}</div></div>`).join('')}</div>
    <p class="faint" style="margin-bottom:0">Purple = an agent’s advice. Only the badge on the right is a person’s approval. Execution needs all three.</p></div>`;

  V.decideApprove = (P) => {
    const lv = P.latest;
    if (P.execution) return head('Approve · ' + P.room.title, `Proposal v${P.execution.v} was approved and executed`, 'All three approvals were recorded; there is nothing left to approve.') + `<a class="btn primary" href="#/room/results">See results</a> <a class="btn" href="#/inbox">Back to inbox</a>`;
    if (!lv || lv.status !== 'ready' || !/approval|executed/.test(P.stage)) {
      const blocked = lv && lv.status === 'blocked';
      return head('Approve · ' + P.room.title, 'Nothing to approve right now', blocked ? `Proposal v${lv.v} is blocked under constraints v${P.cv}. Approval requests for it were withdrawn.` : 'There is no proposal ready for approval.') + `<a class="btn" href="#/inbox">Back to inbox</a> <a class="btn" href="#/room">Open room</a>`;
    }
    const mine = lv.myApproval;
    const recMsg = (P.transcript[lv.v === 2 ? 1 : 3] || []).find(m => m.who === P.role && m.action === 'recommend_accept');
    return head('Approve · ' + P.room.title, `Approve proposal v${lv.v}?`, `You are approving <strong>these exact terms under constraints v${P.cv}</strong>. If the terms or constraints change, you will be asked again.`) +
    `<div class="grid2"><div>
      <div class="card"><div class="row between"><h2>Proposal v${lv.v} · ${esc(lv.label)}</h2>${V.statusBadge(lv.status)}</div>
        <dl class="terms"><dt>In scope</dt><dd>${V.list(lv.scope)}</dd><dt>Deferred</dt><dd>${V.list(lv.deferred)}</dd>
          <dt>Additional cost</dt><dd><strong>${esc(lv.price)}</strong></dd><dt>Delivery</dt><dd>${esc(lv.delivery)}, 2026</dd>
          <dt>Source</dt><dd>Provider’s confirmed offer <span class="mono">${esc(lv.offer)}</span></dd><dt>Checked under</dt><dd>Constraints v${P.cv}</dd></dl>
        <h3 style="margin-top:14px">What changed from v${lv.v - 1}</h3><ul class="plain" style="margin-top:4px">${diff(P, lv)}</ul></div>
      <div class="card"><h3>Code checks</h3><div class="faint">Deterministic checks, re-run on every constraint change. Agents can’t override them.</div>${V.checks(lv.checks)}</div>
      <div class="agent-box" style="margin-top:14px"><div class="lbl">&#9881; Your agent’s recommendation · advisory</div>
        <div style="margin-top:4px"><strong>${lv.myAgentRec ? 'Recommends accepting' : 'No recommendation'}</strong>${recMsg ? ' — “' + esc(recMsg.text) + '”' : ''}</div>
        <div class="faint">This is advice. It is not your approval and is never counted as one.</div></div>
      <div class="human-box" style="margin-top:14px"><div class="lbl">Your decision</div>
        ${mine === 'approved' ? `<p style="margin:6px 0">${V.badge('Approved', 'ok')} You approved v${lv.v} under constraints v${P.cv}. Waiting for the others.</p>`
          : `<div class="row" style="margin-top:8px"><button class="btn primary" data-act="approve" data-v="${lv.v}">Approve v${lv.v} under constraints v${P.cv}</button><button class="btn" data-act="reject">Reject…</button></div>`}
        <div class="why">When the last required person approves, the system writes in one step: change order, budget commitment${P.budget ? ` of ${esc(lv.price)}` : ''}, and ${lv.scope.length + 3} tasks. Internal records only — no payment or signature.</div></div>
    </div><aside>
      ${V.approvalsCard(lv, P)}
      ${budgetPanel(P, lv)}
      <div class="card"><h3>Versions</h3>${P.proposals.map(p => `<div class="line-item"><span>v${p.v} · ${esc(p.label)}</span>${V.statusBadge(p.status)}</div>`).join('')}<a href="#/room/proposals" class="faint">Compare versions</a></div>
    </aside></div>
    <details class="more"><summary>Learn more: how the agents got here</summary><div>${V.transcript(P)}</div></details>`;
  };

  // ---------- 3. 回答取舍 ----------
  V.decideTradeoff = (P) => {
    const rq = P.request;
    if (!rq) return head('Choose · ' + P.room.title, 'No open decision request', 'Nothing to choose right now.') + '<a class="btn" href="#/inbox">Back to inbox</a>';
    const ans = rq.answer && rq.options.find(o => o.offer === rq.answer.offer);
    if (!rq.mine) {
      return head('Choose · ' + P.room.title, 'Customer is choosing a tradeoff', 'The budget constraint changed and two confirmed options fit. Only Customer can trade their date against their scope.') +
      `<div class="options">${rq.options.map(o => `<div class="option" style="cursor:default"><h3>${esc(o.title)}</h3><dl class="terms"><dt>In scope</dt><dd>${V.list(o.scope)}</dd><dt>Cost</dt><dd>${esc(o.price)}</dd><dt>Delivery</dt><dd>${esc(o.delivery)}</dd></dl></div>`).join('')}</div>
      <div class="card" style="margin-top:14px">${rq.status === 'answered' ? `<strong>Customer chose: ${esc(ans.title)}.</strong>${rq.answer.note ? ' Note: “' + esc(rq.answer.note) + '”' : ''}` : V.badge('Waiting on Customer', 'neutral')}
      <p class="faint" style="margin-bottom:0">You see the options’ terms and the final choice. Customer’s private reasons and date rules are not shown.</p></div>`;
    }
    if (rq.status === 'answered') return head('Choose · ' + P.room.title, 'Choice sent', `You chose <strong>${esc(ans.title)}</strong>. The provider agent drafts v3; everyone approves again.`) + '<a class="btn" href="#/inbox">Back to inbox</a> <a class="btn" href="#/room">Open room</a>';
    const pick = V.ui.pick;
    return head('Choose · ' + P.room.title, 'The budget went down. Which matters more for phase 1?', 'Finance lowered the budget (constraints v2), so proposal v2 no longer fits. Agents found two confirmed options that pass the checks. Choosing between them trades <strong>your date</strong> against <strong>your scope</strong>, so it needs you.') +
    `<div class="grid2"><div>
      <div class="options">${rq.options.map(o => `<button class="option" data-act="pick" data-offer="${o.offer}" aria-pressed="${pick === o.offer}">
        <h3>${esc(o.title)}</h3><dl class="terms"><dt>In scope</dt><dd>${V.list(o.scope)}</dd><dt>Deferred</dt><dd>${V.list(o.deferred)}</dd><dt>Cost</dt><dd>${esc(o.price)}</dd><dt>Delivery</dt><dd>${esc(o.delivery)}, 2026</dd></dl>
        <p class="muted" style="margin:10px 0 4px">${esc(o.impact)}</p><span class="faint">Source: confirmed offer ${esc(o.offer)} · fits the budget</span></button>`).join('')}</div>
      <div class="agent-box" style="margin-top:14px"><div class="lbl">&#9881; Your agent’s note · advisory</div><div style="margin-top:4px">${esc(rq.agentNote)}</div></div>
      <div class="human-box" style="margin-top:14px"><div class="lbl">Your answer</div>
        <label class="faint" for="tnote" style="display:block;margin:6px 0 4px">Optional note to the room (shared with Provider and Finance)</label>
        <textarea id="tnote" rows="2" data-input="note" placeholder="e.g. Audit log is needed for our SOC 2 review.">${esc(V.ui.note)}</textarea>
        <div class="row" style="margin-top:10px"><button class="btn primary" data-act="answer" ${pick ? '' : 'disabled'}>Send my choice</button>${pick ? '' : '<span class="why" style="margin:0">Pick an option first.</span>'}</div>
        <div class="why">Only your choice and note are shared — not your private brief.${pick === 'OF-4' ? ' Choosing this records your sign-off on the 7-day slip (a new constraints version).' : ''}</div></div>
    </div><aside>
      <div class="card"><h3>What others see</h3><p class="muted" style="margin:6px 0">Provider and Finance see that you’re deciding, the two options’ terms, and your final choice and note.</p><p class="faint" style="margin:0">They don’t see your required date, your 7-day rule, or your SOC 2 reason.</p></div>
      <div class="card"><h3>What happens next</h3><p class="muted" style="margin:6px 0 0">The provider agent turns your choice into proposal v3. Code re-checks it, then all three of you approve that exact version.</p></div>
    </aside></div>
    <details class="more"><summary>Learn more: why the agents escalated</summary><div>${V.transcript(P)}</div></details>`;
  };
})();

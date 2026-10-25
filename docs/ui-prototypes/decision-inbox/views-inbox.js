// 首页：决策收件箱；房间列表。
(function () {
  const V = window.V, esc = V.esc;
  const KIND = { approve: 'Approve', choose: 'Choose', confirm: 'Confirm', retry: 'Needs attention' };

  function needCard(it, P) {
    return `<article class="card inbox-item k-${it.kind}">
      <div class="stripe" aria-hidden="true"></div>
      <div class="body">
        <div class="kind">${KIND[it.kind]} · <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500">${esc(P.room.title)}</span></div>
        <div class="item-title">${esc(it.title)}</div>
        <div class="muted">${esc(it.sub)}</div>
        <div class="row" style="margin-top:6px">${it.meta ? V.badge(it.meta, 'neutral', 'nodot') : ''}${it.agent ? V.agentChip('Your agent recommends accepting · advisory') : ''}<span class="faint">${esc(it.blocks || '')}</span></div>
      </div>
      <div class="act"><a class="btn ${it.kind === 'retry' ? '' : 'primary'}" href="${it.href}">${esc(it.cta)}</a></div>
    </article>`;
  }

  V.inbox = (P) => {
    const ib = P.inbox;
    const hello = { customer: 'Dana', provider: 'Raj', finance: 'Mei' }[P.role];
    let h = `<div class="page-head"><div><h1>Good morning, ${hello}</h1>
      <p class="muted">${ib.needs.length ? `${ib.needs.length} decision${ib.needs.length > 1 ? 's' : ''} need${ib.needs.length > 1 ? '' : 's'} you. Each one shows only what you need to decide; details stay one click away.` : 'Nothing needs you right now.'}</p></div>
      <div class="row">${V.sim()}<a href="#/rooms" class="btn small">All rooms</a></div></div>`;

    h += V.constraintBanner(P);
    h += `<div class="section-title">Needs you · ${ib.needs.length}</div>`;
    h += ib.needs.length ? `<div class="stack">${ib.needs.map(it => needCard(it, P)).join('')}</div>`
      : `<div class="card empty">You’re all caught up. We’ll put the next decision here when it’s yours to make.</div>`;

    if (ib.working.length) {
      h += `<div class="section-title">Agents working · ${ib.working.length}</div>`;
      h += ib.working.map(w => `<div class="card"><div class="row between"><div class="row"><span class="badge t-busy">In progress</span><strong>${esc(w.title)}</strong></div><a href="#/room" class="faint">Open room</a></div>
        <ul class="plain steps" style="margin-top:8px"><li class="s-active"><span class="dot" aria-hidden="true"></span><span>${esc(w.sub)}</span></li></ul>
        <div class="faint">You don’t need to do anything. If it needs a person, it will show up under “Needs you”.</div></div>`).join('');
    }

    if (ib.waiting.length) {
      h += `<div class="section-title">Waiting on others · ${ib.waiting.length}</div><div class="card">`;
      h += ib.waiting.map(w => `<div class="line-item"><div><div>${esc(w.title)}</div>${w.sub ? `<div class="faint">${esc(w.sub)}</div>` : ''}</div><span class="badge t-neutral">Waiting</span></div>`).join('');
      h += `</div>`;
    }

    if (ib.resolved.length) {
      h += `<div class="section-title">Done & no longer needed</div><div class="card">`;
      h += ib.resolved.map(r => `<div class="line-item"><div>${r.href ? `<a href="${r.href}">${esc(r.title)}</a>` : esc(r.title)}</div>${V.badge(r.tag, r.tone)}</div>`).join('');
      h += `</div>`;
    }
    return h;
  };

  V.rooms = (P) => {
    const n = P.inbox.needs.length;
    const lv = P.latest;
    let h = `<div class="page-head"><div><h1>Rooms</h1><p class="muted">Rooms you are a participant in. Other people’s private briefs are never shown here.</p></div>
      <button class="btn" disabled title="Not part of this prototype">New room</button></div>`;
    h += `<a href="#/room" class="card" style="display:block;color:inherit;text-decoration:none">
      <div class="row between"><div class="row"><h2>${esc(P.room.title)}</h2>${V.sim()}</div>${V.badge(P.stageLabel.text, P.stageLabel.tone)}</div>
      <p class="muted" style="margin:6px 0">${esc(P.room.goal)}</p>
      <div class="row faint">${['customer', 'provider', 'finance'].map(r => V.avatar(r, P)).join('')}
        <span>${lv ? `Proposal v${lv.v}` : 'No proposal yet'} · Constraints v${P.cv}</span>
        ${P.budget ? `<span>· ${esc(P.budget.committed)} of ${esc(P.budget.cap)} committed <span class="priv">Finance only</span></span>` : ''}</div>
      ${n ? `<div style="margin-top:10px">${V.badge(n === 1 ? '1 decision needs you' : n + ' decisions need you', 'info')}</div>` : ''}
    </a>`;
    window.SFM_DATA.otherRooms.filter(r => r.roles.includes(P.role)).forEach(r => {
      h += `<div class="card" style="opacity:.75"><div class="row between"><div class="row"><h2>${esc(r.title)}</h2>${V.sim()}</div>${V.badge(r.status, r.status === 'Executed' ? 'ok' : 'neutral')}</div>
        <p class="faint" style="margin:6px 0 0">${esc(r.note)} · not explorable in this prototype</p></div>`;
    });
    h += `<div class="card"><h3>Invitations</h3><p class="faint">No pending invitations. (Invite & join flow is out of scope for this prototype.)</p></div>`;
    return h;
  };
})();

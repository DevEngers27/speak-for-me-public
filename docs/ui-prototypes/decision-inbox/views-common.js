// 通用渲染：原型条、应用头部、房间头部、小组件。
(function () {
  const V = window.V = {};
  const esc = V.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  V.badge = (text, tone, extra) => `<span class="badge t-${tone} ${extra || ''}">${esc(text)}</span>`;
  V.statusBadge = s => ({
    ready: V.badge('Ready for approval', 'info'), blocked: V.badge('Blocked', 'bad'),
    executed: V.badge('Executed', 'ok'), superseded: V.badge('Superseded', 'neutral')
  })[s];
  V.humanBadge = h => ({ approved: V.badge('Approved', 'ok'), pending: V.badge('Pending', 'neutral'), stale: V.badge('No longer applies', 'warn') })[h];
  V.agentChip = (txt) => `<span class="agent-chip" title="Advisory only — not an approval">&#9881; ${esc(txt || 'Agent recommends accepting')}</span>`;
  V.sim = () => '<span class="sim" title="All data in this room is simulated">Simulated</span>';
  V.avatar = (role, P) => `<span class="avatar av-${role}" aria-hidden="true">${esc(P.people[role].initials)}</span>`;
  V.list = arr => arr.length ? esc(arr.join(', ')) : '<span class="faint">None</span>';

  V.checks = checks => `<ul class="plain checks">${checks.map(c => `<li><span class="mark ${c.ok ? 'ok' : 'no'}" aria-hidden="true">${c.ok ? '✓' : '✕'}</span><div><div>${esc(c.text)} <span class="sr-only">${c.ok ? '(pass)' : '(fail)'}</span></div>${c.note ? `<div class="faint">${esc(c.note)}</div>` : ''}<div class="code">${esc(c.code)}</div></div></li>`).join('')}</ul>`;

  // 与场景阶段对应的演示提示（只在原型条中出现）
  function guide(P) {
    const r = P.role; const failed = P.lastRun && P.lastRun.status === 'failed';
    if (failed) return '<b>Next:</b> an agent run failed. Open the room and press <i>Retry run</i> (any role).';
    return ({
      brief: r === 'finance' ? '<b>Next:</b> open <i>Confirm your private brief</i> in your inbox.' : '<b>Next:</b> switch to <i>Finance</i> and confirm the extracted brief.',
      negotiating: 'Agents are negotiating (simulated, a few seconds). Watch the inbox “Agents working” section or the room.',
      approval_v2: '<b>Next:</b> approve v2 as Customer (and Provider). Then, as Finance, lower the cap to $4,800 on the Budget tab — or use the shortcut button.',
      renegotiating: 'Agents are renegotiating under constraints v2. Tick “Next agent run fails” before the cut to see the failure state.',
      tradeoff: r === 'customer' ? '<b>Next:</b> answer the tradeoff in your inbox.' : '<b>Next:</b> switch to <i>Customer</i> to answer the tradeoff.',
      formalizing: 'Provider agent is drafting v3 from the customer’s answer…',
      approval_v3: '<b>Next:</b> approve v3 as each of the three roles. The last approval executes.',
      executed: '<b>Done:</b> see the change order, commitment and tasks on the Results tab. Try “Repeat execution request” to see idempotency.'
    })[P.stage];
  }

  V.protoBar = (P) => {
    const roles = ['customer', 'provider', 'finance'];
    return `<div class="proto" role="region" aria-label="Prototype controls"><div class="proto-inner">
      <span class="proto-tag">Prototype only</span>
      <span>Viewing as</span>
      <span class="seg" role="group" aria-label="Switch role (replaces sign-in in this prototype)">${roles.map(r => `<button data-act="role" data-role="${r}" aria-pressed="${P.role === r}">${esc(P.people[r].label)} · ${esc(P.people[r].name.split(' ')[0])}</button>`).join('')}</span>
      <span class="spacer"></span>
      <button class="pbtn" data-act="cut" ${P.stage === 'approval_v2' ? '' : 'disabled title="Available while v2 awaits approval"'}>Finance lowers cap to $4,800</button>
      <label><input type="checkbox" data-act="failnext" ${P.failNext ? 'checked' : ''}> Next agent run fails</label>
      <button class="pbtn" data-act="reset">Reset scenario</button>
      <div class="guide">${guide(P)} <span style="opacity:.7">Role switching stands in for real sign-in.</span></div>
    </div></div>`;
  };

  V.appHead = (P, route) => {
    const n = P.inbox.needs.length;
    const cur = (k) => route[0] === k ? 'aria-current="page"' : '';
    return `<header class="app-head"><div class="app-head-inner">
      <a class="logo" href="#/inbox">Speak <span>for</span> Me</a>
      <nav class="nav" aria-label="Main">
        <a href="#/inbox" ${cur('inbox') || (route[0] === 'decide' ? 'aria-current="page"' : '')}>Inbox${n ? `<span class="count" aria-label="${n} decisions need you">${n}</span>` : ''}</a>
        <a href="#/rooms" ${cur('rooms') || cur('room')}>Rooms</a>
      </nav>
      <span class="spacer"></span>
      <div class="who">${V.avatar(P.role, P)}<div><div><strong>${esc(P.me.name)}</strong></div><div class="faint">${esc(P.me.label)} · ${esc(P.me.org)}</div></div></div>
    </div></header>`;
  };

  V.roomHead = (P, tab) => {
    const tabs = [['overview', 'Overview', '#/room'], ['proposals', 'Proposals & versions', '#/room/proposals'], ['brief', 'My private brief', '#/room/brief']];
    if (P.role === 'finance') tabs.push(['budget', 'Budget', '#/room/budget']);
    tabs.push(['results', 'Results', '#/room/results'], ['timeline', 'Timeline', '#/room/timeline']);
    const lv = P.latest;
    return `<div class="room-head">
      <a href="#/rooms" class="faint">&larr; Rooms</a>
      <div class="row" style="margin-top:6px"><h1>${esc(P.room.title)}</h1>${V.sim()}${V.badge(P.stageLabel.text, P.stageLabel.tone)}</div>
      <div class="room-meta"><span>${esc(P.room.scenario)}</span><span>·</span>
        <span>${lv ? `Proposal v${lv.v}` : 'No proposal yet'} · Constraints v${P.cv}</span><span>·</span>
        <span>Viewing as ${esc(P.me.label)}</span></div>
      <nav class="tabs" aria-label="Room sections">${tabs.map(t => `<a href="${t[2]}" ${tab === t[0] ? 'aria-current="page"' : ''}>${t[1]}</a>`).join('')}</nav>
    </div>`;
  };

  // 预算下调后的阻断横幅（按角色裁剪文案）
  V.constraintBanner = (P) => {
    if (P.cv < 2 || !['renegotiating', 'tradeoff', 'formalizing'].includes(P.stage)) return '';
    const v2 = P.proposals.find(p => p.v === 2);
    const fin = P.role === 'finance';
    const mine = v2 && v2.myApproval === 'stale';
    return `<div class="banner bad" role="status"><div><strong>Constraints changed (now v${P.cv}). Proposal v2 can no longer execute.</strong>
      ${fin ? `You lowered the cap to ${esc(P.budget.cap)}. v2 would bring the total to ${esc(v2.totalAfter)}.` : 'Finance updated a budget constraint, and v2 no longer fits it. Amounts stay private to Finance.'}
      ${mine ? ' Your earlier approval of v2 no longer applies — it stays in history.' : ' Earlier approvals of v2 no longer apply; they stay in history.'}
      ${P.stage === 'renegotiating' ? (P.lastRun && P.lastRun.status === 'failed' ? ' The renegotiation run failed and needs a retry.' : ' Agents are renegotiating now.') : P.stage === 'tradeoff' ? ' Agents need a person to choose a tradeoff.' : ''}</div></div>`;
  };

  V.runCard = (P, compact) => {
    const r = P.lastRun;
    if (!r) return `<div class="card"><h3>Agent runs</h3><p class="faint">No agent run yet. Negotiation starts when all three briefs are confirmed.</p></div>`;
    const tone = { running: 'busy', succeeded: 'ok', failed: 'bad' }[r.status];
    const steps = compact && r.status === 'succeeded' ? '' : `<ul class="plain steps" style="margin-top:10px">${r.steps.map(s => `<li class="s-${s.state}"><span class="dot" aria-hidden="true"></span><span>${esc(s.text)}</span></li>`).join('')}</ul>`;
    return `<div class="card" aria-live="polite"><div class="row between"><h3>Agent run <span class="mono">${esc(r.id)}</span></h3>${V.badge(r.status === 'running' ? 'In progress' : r.status === 'failed' ? 'Failed' : 'Completed', tone)}</div>
      <div class="faint">${esc(r.purpose)} · ${P.runs.length} run(s) in this room</div>${steps}
      ${r.status === 'failed' ? `<div class="banner bad" style="margin:12px 0 0"><div><strong>${esc(r.error)}</strong>Proposals, approvals and constraints are unchanged.<div style="margin-top:8px"><button class="btn small" data-act="retry">Retry run</button></div></div></div>` : ''}
      ${r.status === 'running' ? '<div class="why">Agents only propose and recommend. Every term is re-checked by code; nothing executes without people approving.</div>' : ''}
    </div>`;
  };

  V.transcript = (P) => {
    const done = P.runs.filter(r => r.status === 'succeeded').map(r => r.n);
    const ns = [...new Set(done)];
    if (!ns.length) return '<p class="faint">No agent messages yet. This view never invents messages.</p>';
    return ns.map(n => `<div class="faint" style="margin-top:10px">Run ${n}</div>` + P.transcript[n].map(m => `<div class="msg"><div><div>${m.who === 'system' ? 'System' : esc(P.people[m.who].label) + ' agent'}</div><div class="act">${esc(m.action)} · base ${esc(m.base)}</div></div><div>${esc(m.text)}</div></div>`).join('')).join('') +
      '<p class="faint" style="margin-top:10px">Shows shareable text only — not private briefs or hidden reasoning. Agent messages are advisory: only people approve.</p>';
  };

  V.toast = (st) => st.toast ? `<div class="toast ${st.toast.kind}" role="status">${esc(st.toast.text)}</div>` : '';
})();

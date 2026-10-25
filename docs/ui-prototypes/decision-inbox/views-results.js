// 房间：执行结果（变更单、预算承诺、任务、审批记录）与事件时间线。
(function () {
  const V = window.V, esc = V.esc;
  V.ui = V.ui || {};
  V.ui.filter = V.ui.filter || 'all';

  function blockers(P) {
    const out = [];
    const lv = P.latest;
    if (!lv) out.push('No proposal yet.');
    else {
      lv.checks.filter(c => !c.ok).forEach(c => out.push(`v${lv.v}: ${c.text} (${c.code})`));
      if (lv.status === 'ready') lv.approvals.filter(a => a.human !== 'approved').forEach(a => out.push(`Waiting for ${P.people[a.role].label} to approve v${lv.v}.`));
    }
    if (P.request && P.request.status === 'open') out.push('Customer has an open decision request.');
    if (P.lastRun && P.lastRun.status === 'running') out.push('An agent run is in progress.');
    if (P.lastRun && P.lastRun.status === 'failed') out.push('The last agent run failed and needs a retry.');
    return out;
  }

  V.roomResults = (P) => {
    let h = V.roomHead(P, 'results');
    const ex = P.execution;
    if (!ex) {
      h += `<div class="card"><h2>No executed agreement yet</h2><p class="muted">Execution happens automatically, once, when every required person has approved the same version under the current constraints.</p>
        <h3 style="margin-top:10px">What’s in the way</h3><ul>${blockers(P).map(b => `<li>${esc(b)}</li>`).join('')}</ul><a href="#/room">Back to overview</a></div>`;
    } else {
      h += `<div class="grid2"><div>
        <div class="card"><div class="row between"><h2>Change order ${esc(ex.co)}</h2>${V.badge('Recorded', 'ok')}</div>
          <dl class="terms"><dt>Based on</dt><dd>Proposal v${ex.v} · constraints v${ex.cv}</dd><dt>In scope</dt><dd>${V.list(ex.scope)}</dd><dt>Deferred</dt><dd>${V.list(ex.deferred)}</dd>
          <dt>Amount</dt><dd><strong>${esc(ex.price)}</strong></dd><dt>Delivery</dt><dd>${esc(ex.delivery)}, 2026</dd><dt>Recorded</dt><dd>${esc(ex.time)}</dd>
          <dt>Operation</dt><dd class="mono">${esc(ex.op)}</dd></dl>
          <p class="faint" style="margin-bottom:0">An internal record only. No payment, transfer or e-signature happens in this system.</p></div>
        <div class="card"><div class="row between"><h2>Budget commitment</h2>${ex.budget ? '<span class="priv">Finance only</span>' : ''}</div>
          ${ex.budget ? `<dl class="terms"><dt>Cap</dt><dd>${esc(ex.budget.cap)}</dd><dt>Before</dt><dd>${esc(ex.budget.before)}</dd><dt>This commitment</dt><dd>${esc(ex.price)}</dd><dt>After</dt><dd><strong>${esc(ex.budget.after)}</strong></dd><dt>Left</dt><dd>${esc(ex.budget.left)}</dd></dl><p class="faint">Snapshot taken at execution time, not recomputed later.</p>`
            : `<p class="muted">A commitment of ${esc(ex.price)} was recorded against Finance’s budget. Budget totals are private to Finance.</p>`}</div>
        <div class="card"><h2>Tasks · ${ex.tasks.length}</h2><div class="faint">Only the assignee can mark a task done.</div>
          ${ex.tasks.map(t => `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-act="task" data-id="${t.id}" ${t.done ? 'checked' : ''} ${t.mine ? '' : 'disabled'} aria-label="${esc(t.title)}"><div style="flex:1"><div class="ttl">${esc(t.title)}</div><div class="faint">${esc(t.who)} · ${esc(P.people[t.assignee].label)} · due ${esc(t.due)}</div></div>${t.mine ? V.badge('Yours', 'info') : ''}</div>`).join('')}</div>
      </div><aside>
        <div class="card"><h3>Approval record</h3><div class="faint">Every decision, including ones that no longer apply.</div>
          ${P.decisions.map(d => `<div class="line-item"><div><div>${esc(d.name)} approved v${d.v}</div><div class="faint">constraints v${d.cv} · ${esc(d.time)}</div></div>${V.badge(d.tag, d.tag === 'No longer applies' ? 'warn' : 'ok')}</div>`).join('')}</div>
        <div class="card"><h3>Retry safety</h3><p class="muted" style="margin:6px 0 10px">Repeated or concurrent execution requests reuse operation <span class="mono">${esc(ex.op)}</span> and never create a second record.</p>
          <button class="btn small" data-act="dup">Repeat execution request <span class="faint">(prototype)</span></button></div>
      </aside></div>`;
    }
    return h;
  };

  const GROUPS = {
    decisions: ['decision_recorded', 'approval_requested', 'approval_stale', 'human_request_opened', 'human_request_answered', 'execution_completed', 'execution_deduplicated'],
    constraints: ['constraints_changed', 'proposal_blocked', 'brief_confirmed', 'brief_extracted', 'brief_detail'],
    agents: ['run_started', 'run_completed', 'run_failed', 'run_retry', 'proposal_posted']
  };

  V.roomTimeline = (P) => {
    let h = V.roomHead(P, 'timeline');
    const f = V.ui.filter;
    const evs = P.events.filter(e => f === 'all' || (GROUPS[f] || []).includes(e.type));
    h += `<div class="row between" style="margin-bottom:12px"><div class="filters" role="group" aria-label="Filter events">
      ${[['all', 'All'], ['decisions', 'Decisions'], ['constraints', 'Constraints & briefs'], ['agents', 'Agent runs']].map(x => `<button data-act="filter" data-f="${x[0]}" aria-pressed="${f === x[0]}">${x[1]}</button>`).join('')}</div>
      <span class="faint">${evs.length} events · newest first</span></div>
      <div class="card" aria-live="polite">${evs.map(e => `<div class="ev"><div><div class="faint">${esc(e.time)}</div><div class="type">${esc(e.type)}</div></div><div>${esc(e.text)} ${e.private ? '<span class="priv">Private to you</span>' : ''} ${e.seeded ? '<span class="sim">Seeded fixture</span>' : ''}</div></div>`).join('') || '<p class="faint">No events in this filter.</p>'}</div>
      <p class="faint">The log records actions, versions and outcomes — not hidden model reasoning. Events with amounts are split by audience: Finance sees amounts, others see the outcome.</p>`;
    return h;
  };
})();

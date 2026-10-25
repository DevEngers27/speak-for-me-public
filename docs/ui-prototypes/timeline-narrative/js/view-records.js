// 执行记录页：变更单、承诺、任务、追溯链、审批记录、事件日志。
(function () {
  const S = SFM.S; const P = SFM.PEOPLE; const M = SFM.money; const E = SFM.esc;

  function blockers() {
    const out = []; const v = S.current;
    if (!v) out.push('No proposal yet. Agents start once all three private briefs are confirmed.');
    else {
      const st = SFM.proposalStatus(v);
      if (st === 'blocked') out.push('Proposal v' + v + ' fails the rules check under constraints v' + S.cv + '.');
      SFM.ROLES.forEach(function (r) { const d = SFM.decisionFor(r, v).state; if (d !== 'approved') out.push(P[r].name + ': ' + (d === 'stale' ? 'earlier approval no longer applies' : d)); });
    }
    if (S.stage === 'awaiting_tradeoff') out.push('Waiting on Avery to answer the trade-off request.');
    if (S.stage === 'run_failed') out.push('The last agent round failed; a retry is needed.');
    return out;
  }

  SFM.recordsPage = function () {
    const me = S.role; let main = '';
    if (!S.exec) {
      main = '<section class="card"><h2>No executed agreement yet</h2><p class="muted">Records are written only after every required person approves the same version under the current constraints.</p><ul class="blockers">' +
        blockers().map(function (b) { return '<li>' + E(b) + '</li>'; }).join('') + '</ul><a class="btn" href="#/room/scope-change">Back to timeline</a></section>';
    } else {
      const x = S.exec;
      main = '<section class="card co"><div class="cur-top"><h2>Change order ' + x.co + '</h2>' + SFM.pill(['Executed', 'ok']) + '</div>' +
        '<p class="ver">Based on proposal v' + x.v + ' · constraints v' + x.cv + ' · quote ' + x.quote + '</p>' + SFM.termsTable(S.proposals[x.v], 'none') +
        '<dl class="nums"><dt>Recorded</dt><dd>' + x.time + '</dd><dt>Operation id</dt><dd><code>' + x.op + '</code></dd></dl>' +
        '<p class="small muted">An internal record only. No payment, transfer or e-signature happens in this product.</p></section>' +
        '<section class="card"><h2>Budget commitment</h2><p><b>' + M(x.cents) + '</b> committed for ' + x.co + '.</p>' +
        (me === 'finance' ? '<dl class="nums"><dt>Before</dt><dd>' + M(x.totalAfter - x.cents) + '</dd><dt>This commitment</dt><dd>' + M(x.cents) + '</dd><dt>After</dt><dd>' + M(x.totalAfter) + '</dd><dt>Cap at execution</dt><dd>' + M(x.cap) + '</dd><dt>Remaining</dt><dd>' + M(x.cap - x.totalAfter) + '</dd></dl><p class="small muted">Snapshot taken at execution, not recomputed later. <span class="tag priv">Finance only</span></p>' :
          '<p class="small muted">Budget totals are visible to finance only.</p>') + '</section>' +
        '<section class="card"><h2>Tasks</h2><ul class="tasks">' + x.tasks.map(function (t) {
          const mine = t.role === me;
          return '<li><label><input type="checkbox" data-act="task" data-id="' + t.id + '"' + (S.tasksDone[t.id] ? ' checked' : '') + (mine ? '' : ' disabled') + '> ' + E(t.text) + '</label><span class="muted small">' + P[t.role].short + ' · due ' + SFM.day(t.due) + (mine ? '' : ' · only ' + P[t.role].short + ' can update') + '</span></li>';
        }).join('') + '</ul></section>';
      const anc = SFM.ancestors(S.refs.exec);
      main += '<section class="card"><h2>How ' + x.co + ' came about</h2><ol class="chain">' + S.events.filter(function (e) { return anc[e.id] && (e.vis === 'room' || e.vis === me); }).map(function (e) {
        return '<li class="a-' + e.actor.type + '"><span class="muted small">' + e.time + '</span> ' + E(SFM.describe(e, me).title) + '</li>';
      }).join('') + '</ol><button class="btn ghost small" data-act="trace-go" data-id="' + S.refs.exec + '">Show this chain in the timeline</button></section>';
    }
    const decs = S.decisions.slice().reverse();
    const side = '<section class="card"><h2>Approval record</h2>' + (decs.length ? '<ul class="drec">' + decs.map(function (d) {
      const used = S.exec && S.exec.v === d.v && S.exec.cv === d.cv && d.decision === 'approved';
      const cur = SFM.decisionFor(d.role, d.v); const label = used ? ['Used for execution', 'ok'] : d.cv !== S.cv ? ['No longer applies', 'stale'] : cur.d === d ? ['Current', 'ask'] : ['Replaced', 'muted'];
      return '<li><span>' + (d.role === me ? 'You' : P[d.role].name) + ' ' + d.decision + ' v' + d.v + ' · constraints v' + d.cv + '<br><span class="muted small">' + d.time + '</span></span>' + SFM.pill(label) + '</li>';
    }).join('') + '</ul>' : '<p class="muted">No decisions yet.</p>') + '<p class="small muted">Every decision is kept, including ones that no longer apply.</p></section>' +
      '<section class="card"><h2>Event log</h2><p class="small muted">Actions, versions and outcomes. Hidden model reasoning is never logged.</p><ol class="elog">' +
      S.events.filter(function (e) { return e.vis === 'room' || e.vis === me; }).slice().reverse().map(function (e) {
        return '<li><span class="muted small">' + e.time + ' · ' + E(SFM.actorLabel(e, me)) + (e.vis !== 'room' ? ' · private to you' : '') + '</span><br>' + E(SFM.describe(e, me).title) + '</li>';
      }).join('') + '</ol></section>';
    return SFM.roomHeader('records') + '<div class="two-col"><div>' + main + '</div><div>' + side + '</div></div>';
  };
})();

// 事件描述：同一事件按查看者角色返回不同标题与正文（模拟服务端披露投影）。
(function () {
  const S = SFM.S; const P = SFM.PEOPLE; const M = SFM.money; const D = SFM.day; const E = SFM.esc;
  function who(role, me) { return SFM.who(role, me); }
  function whoShort(role, me) { return role === me ? 'You' : P[role].short; }
  const checkList = SFM.checkList;

  // 主函数：返回 {title, sub, body, tags}
  SFM.describe = function (ev, me) {
    const out = { title: ev.kind, sub: '', body: '', tags: [] };
    const k = ev.kind;
    if (ev.vis !== 'room') out.tags.push(['priv', 'Private to you']);
    if (ev.seeded) out.tags.push(['sim', 'Seeded · simulated']);

    if (k === 'room_created') {
      out.title = 'Room opened: Loyalty launch scope change';
      out.sub = 'Avery invited Kitebridge Studio (provider) and Marcus Webb (finance). Three approvals required.';
      out.body = '<p><b>Shared goal:</b> Agree on the scope, price and delivery date for the loyalty-program change request.</p>';
    } else if (k === 'brief_confirmed') {
      const b = SFM.BRIEFS[ev.who]; const shared = b.items.filter(function (i) { return i.share; });
      if (ev.who === me) {
        out.title = 'You confirmed your private brief v' + ev.v;
        out.sub = shared.length + ' items shared with the room, ' + (b.items.length - shared.length) + ' kept private' + (b.quotes ? ', ' + b.quotes.length + ' confirmed quotes' : '') + '.';
        out.body = '<ul class="brief-mini">' + b.items.map(function (i) {
          return '<li><span class="tag ' + (i.share ? 'shared' : 'priv') + '">' + (i.share ? 'Shared' : 'Private') + '</span> ' + E(i.text) + '</li>';
        }).join('') + '</ul>';
      } else {
        out.title = P[ev.who].name + ' confirmed a private brief (v' + ev.v + ')';
        out.sub = 'You see only what ' + P[ev.who].short + ' chose to share. Private items stay private.';
        out.body = '<p class="muted">Shared by ' + P[ev.who].short + ':</p><ul class="brief-mini">' + shared.map(function (i) {
          return '<li><span class="tag shared">Shared</span> ' + E(i.text) + '</li>';
        }).join('') + '</ul>' + (b.quotes ? '<p class="muted">' + b.quotes.length + ' confirmed quotes. Prices become visible only when a proposal cites one.</p>' : '');
      }
    } else if (k === 'agent_context') {
      const n = S.runs[ev.runId].n;
      out.title = "Your agent's context for round #" + n;
      out.sub = 'Your brief plus facts others chose to share. Other private briefs are not included.';
      const others = SFM.ROLES.filter(function (r) { return r !== me; });
      out.body = '<div class="two"><div><h4>Included</h4><ul><li>Your private brief v1, all items</li>' + others.map(function (r) {
        return '<li>Items ' + P[r].short + ' shared with the room</li>'; }).join('') + '<li>Room constraints v' + S.cv + '</li></ul></div>' +
        '<div><h4>Never included</h4><ul>' + others.map(function (r) { return '<li>' + P[r].short + "'s private items</li>"; }).join('') + '</ul></div></div>';
    } else if (k === 'run') {
      const r = S.runs[ev.runId];
      out.title = 'Agent round #' + r.n + ' · ' + r.title;
      out.sub = 'Triggered by: ' + r.reason;
      out.run = r;
    } else if (k === 'proposal') {
      const p = S.proposals[ev.v];
      out.title = 'Proposal v' + ev.v + ' drafted by provider agent';
      out.sub = SFM.itemList(p.items) + ' · ' + M(p.cents) + ' · delivery ' + D(p.date);
      out.body = SFM.termsTable(p, me) + '<p class="muted">Checked against constraints v' + p.cv + '. Proposals are append-only: v' + ev.v + ' will never be edited.</p>';
      out.status = SFM.proposalStatus(ev.v);
    } else if (k === 'check') {
      const fails = ev.chk.results.filter(function (r) { return !r.pass; }).length;
      out.title = 'Rules check on v' + ev.v + ': ' + (fails ? fails + ' failed' : 'all passed');
      out.sub = 'Deterministic code, constraints v' + ev.chk.cv + '. Model claims are not trusted.';
      out.body = checkList(ev.chk, me);
      out.tags.push([fails ? 'bad' : 'ok', fails ? 'Not executable' : 'Executable']);
    } else if (k === 'agent_message') {
      out.title = 'Customer agent countered v' + ev.v;
      out.sub = ev.text;
      out.body = '<p class="muted">Action: counter · based on proposal v' + ev.v + ' · constraints v1. Shared text only; the agent\'s private reasoning is not logged.</p>';
    } else if (k === 'recommend') {
      out.title = 'Agents recommend accepting v' + ev.v;
      out.sub = 'Advisory only. A recommendation is not an approval: each person must approve v' + ev.v + ' themselves.';
      out.tags.push(['adv', 'Advisory']);
    } else if (k === 'decision') {
      const st = SFM.decisionFor(ev.who, ev.v);
      const latest = st.d && st.d.eventId === ev.id;
      out.title = who(ev.who, me) + ' ' + ev.decision + ' v' + ev.v + ' under constraints v' + ev.cv;
      out.sub = ev.decision === 'approved' ? 'A human decision, bound to this exact version and constraints.' : 'Recorded with reason: "Needs changes before I can commit." The proposal stays open.';
      if (ev.cv !== S.cv) { out.sub = 'No longer applies: constraints changed to v' + S.cv + '. Kept in history, not counted.'; out.tags.push(['stale', 'No longer applies']); }
      else if (!latest) out.tags.push(['stale', 'Replaced by a later decision']);
      out.tags.push(['human', 'Human decision']);
    } else if (k === 'constraint_change' && ev.field === 'cap') {
      out.title = me === 'finance' ? 'You lowered the budget cap: ' + M(ev.from) + ' → ' + M(ev.to) : 'Finance changed the budget constraints';
      out.sub = 'Constraints v' + ev.cvFrom + ' → v' + ev.cvTo + '. ' + (me === 'finance' ? 'Room now sees ' + M(ev.to - SFM.BUDGET.committed) + ' available.' :
        'Available for this change: ' + M(ev.from - SFM.BUDGET.committed) + ' → ' + M(ev.to - SFM.BUDGET.committed) + ' (shared by finance). The cap itself stays private.');
      out.tags.push(['warn', 'Constraint change']);
    } else if (k === 'constraint_change' && ev.field === 'deadline') {
      out.title = me === 'customer' ? 'You moved your first-delivery deadline: ' + D(ev.from) + ' → ' + D(ev.to) : P.customer.name + ' updated a private constraint';
      out.sub = 'Constraints v' + ev.cvFrom + ' → v' + ev.cvTo + '. ' + (me === 'customer' ? 'Others see only that a private constraint changed.' : 'The new value is not shared; code re-checks proposals against it.');
      out.tags.push(['warn', 'Constraint change']);
    } else if (k === 'blocked') {
      const b = ev.chk.results[0];
      out.title = 'Proposal v' + ev.v + ' blocked under constraints v' + ev.chk.cv;
      out.sub = SFM.checkLine(b, me) + '.';
      out.body = checkList(ev.chk, me) + '<p class="muted">v' + ev.v + ' can no longer execute. Nothing was deleted: the proposal, its checks and approvals remain in history.</p>';
      out.tags.push(['bad', 'Blocked']);
    } else if (k === 'stale') {
      out.title = ev.roles.length ? ev.roles.length + ' approval' + (ev.roles.length > 1 ? 's' : '') + ' of v' + ev.v + (ev.roles.length > 1 ? ' no longer apply' : ' no longer applies') : 'No approvals carried over';
      out.sub = ev.roles.length ? ev.roles.map(function (r) { return whoShort(r, me); }).join(' and ') + ' approved under constraints v1. Kept in history; no longer counted.' :
        'Approvals are bound to a constraints version, so any approval of v' + ev.v + ' under v1 would no longer count.';
      out.tags.push(['stale', 'Invalidated']);
    } else if (k === 'run_failed') {
      out.title = 'Agent round #' + S.runs[ev.runId].n + ' failed after 3 attempts';
      out.sub = 'No proposal, approval or record changed. Any participant can ask the agents to retry.';
      out.tags.push(['bad', 'Failed']);
      out.retry = S.stage === 'run_failed';
    } else if (k === 'retry_requested') {
      out.title = who(ev.actor.role, me) + ' asked the agents to retry';
      out.sub = 'A new round starts from the same inputs. The failed round stays in history.';
    } else if (k === 'tradeoff') {
      const t = S.tradeoff;
      out.title = 'Decision requested from ' + (me === 'customer' ? 'you' : 'Avery Chen (Customer)');
      out.sub = me === 'customer' ? 'No confirmed option fits every constraint within ' + M(S.cap - SFM.BUDGET.committed) + '. Your agent will not choose for you.' :
        'Only Avery can answer: the choice involves Avery\'s own priorities and private deadline.';
      out.tradeoff = t; out.tags.push(['ask', t.answer ? 'Answered' : 'Waiting on ' + (me === 'customer' ? 'you' : 'Avery')]);
    } else if (k === 'tradeoff_answer') {
      const o = S.tradeoff.options.find(function (x) { return x.key === ev.key; });
      out.title = who('customer', me) + ' chose: ' + o.title;
      out.sub = 'Recorded as a human decision. Agents draft v3 from this choice; it still needs three approvals.';
      out.tags.push(['human', 'Human decision']);
    } else if (k === 'execution') {
      const x = S.exec;
      out.title = 'Executed: change order ' + x.co;
      out.sub = 'One transaction wrote 1 change order, 1 budget commitment (' + M(x.cents) + ') and ' + x.tasks.length + ' tasks. Operation ' + x.op + '.';
      out.body = '<p>Internal records only. No payment, transfer or e-signature happened.</p><p><a href="#/room/scope-change/records">Open records →</a></p>';
      out.tags.push(['ok', 'Executed']);
    } else if (k === 'duplicate_ignored') {
      out.title = 'Duplicate execution request ignored';
      out.sub = 'Same operation id ' + ev.op + '. No second change order, commitment or task was written.';
    } else if (k === 'task') {
      const t = S.exec.tasks.find(function (x) { return x.id === ev.task; });
      out.title = who(ev.actor.role, me) + (ev.done ? ' completed a task' : ' reopened a task');
      out.sub = t.text;
    }
    return out;
  };
})();

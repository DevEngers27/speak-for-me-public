// 右侧固定栏："你的下一步" + "当前方案"摘要卡 + finance 专属预算控制。
// 关键：代理建议（Advisory）与人的批准分区显示，按钮文案带版本号。
(function () {
  const S = SFM.S; const P = SFM.PEOPLE; const M = SFM.money; const E = SFM.esc;

  function nextStep() {
    const me = S.role; const v = S.current; let h = ''; let btn = '';
    const waitingOn = function () {
      return SFM.ROLES.filter(function (r) { return r !== me && SFM.decisionFor(r, v).state !== 'approved'; })
        .map(function (r) { return P[r].short; }).join(' and ');
    };
    if (S.stage === 'briefs') {
      if (me === 'finance') { h = 'Confirm your private brief. Agents start negotiating once all three briefs are confirmed.'; btn = '<button class="btn primary" data-act="confirm-brief">Confirm brief v1</button> <a class="btn ghost" href="#/room/scope-change/brief">Review brief first</a>'; }
      else h = 'Waiting on Marcus (finance) to confirm a private brief. Nothing needs you yet.';
    } else if (S.stage === 'negotiating' || S.stage === 'renegotiating') {
      h = 'Agents are taking turns. Nothing needs you yet; watch the live round in the timeline.';
      if (S.stage === 'renegotiating' && SFM.decisionFor(me, 2).state === 'stale') h += ' Your approval of v2 no longer applies.';
    } else if (S.stage === 'run_failed') {
      h = 'The agent round failed after 3 attempts. Nothing changed. You can ask the agents to retry.';
      btn = '<button class="btn primary" data-act="retry">Retry negotiation</button>';
    } else if (S.stage === 'awaiting_tradeoff') {
      if (me === 'customer') { h = 'Your agent needs a decision only you can make: on time with one module fewer, or all modules one week late.'; btn = '<button class="btn primary" data-act="goto" data-id="' + S.refs.tradeoff + '">Answer the request</button>'; }
      else h = 'Waiting on Avery to choose between two options. You will be asked to approve the result.';
    } else if (S.stage === 'approval' || S.stage === 'approval2') {
      const st = SFM.decisionFor(me, v).state;
      if (st === 'approved') h = 'You approved v' + v + '. Waiting on ' + (waitingOn() || 'execution') + '.';
      else h = 'Review proposal v' + v + ' and decide. ' + (st === 'rejected' ? 'You rejected it; you can still change your decision.' : '');
      if (me === 'finance' && S.cv === 1) h += ' Budget changes go through the budget controls below.';
    } else if (S.stage === 'executed') {
      const mine = S.exec.tasks.filter(function (t) { return t.role === me && !S.tasksDone[t.id]; }).length;
      h = 'Change order ' + S.exec.co + ' is executed.' + (mine ? ' You have ' + mine + ' open task' + (mine > 1 ? 's' : '') + '.' : '');
      btn = '<a class="btn primary" href="#/room/scope-change/records">Open records</a>';
    }
    return '<section class="card next" aria-labelledby="next-h"><h2 id="next-h">Your next step</h2><p>' + E(h) + '</p>' + (btn ? '<div class="row">' + btn + '</div>' : '') + '</section>';
  }

  function approvalRows(v) {
    return '<ul class="approvals">' + SFM.ROLES.map(function (r) {
      const st = SFM.decisionFor(r, v);
      const map = { approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], stale: ['No longer applies', 'stale'], pending: ['Pending', 'muted'] }[st.state];
      const note = st.state === 'stale' ? 'Approved under constraints v' + st.d.cv + '; constraints are now v' + S.cv :
        st.d ? SFM.ROLE_LABEL[r] + ' · v' + st.d.v + ' · constraints v' + st.d.cv : SFM.ROLE_LABEL[r] + ' · required';
      return '<li><span><b>' + (r === S.role ? 'You' : P[r].name) + '</b><span class="muted small">' + E(note) + '</span></span>' + SFM.pill(map) + '</li>';
    }).join('') + '</ul>';
  }

  function current() {
    const v = S.current;
    if (!v) return '<section class="card cur" aria-labelledby="cur-h"><h2 id="cur-h">Current proposal</h2><p class="muted">No proposal yet. Agents draft one after all three private briefs are confirmed.</p></section>';
    const p = S.proposals[v]; const status = SFM.proposalStatus(v); const me = S.role;
    const myState = SFM.decisionFor(me, v).state;
    const rec = S.refs['rec_' + v];
    let h = '<section class="card cur st-' + status + '" aria-labelledby="cur-h"><div class="cur-top"><h2 id="cur-h">Current proposal</h2>' + SFM.pill(SFM.PSTATUS[status] || ['Draft', 'muted']) + '</div>' +
      '<p class="ver big">v' + v + ' <span class="muted">· drafted under constraints v' + p.cv + ' · now v' + S.cv + '</span></p>' + SFM.termsTable(p, me);
    if (status === 'blocked') {
      const live = SFM.liveCheck(v); const bad = live.results.filter(function (r) { return !r.pass; });
      h += '<div class="alert bad"><b>Blocked under constraints v' + S.cv + '.</b> ' + '<br>' + bad.map(function (r) { return E(SFM.checkLine(r, me)); }).join('<br>') +
        '<br><button class="btn small" data-act="trace" data-id="' + (S.refs.blocked || p.checkEventId) + '">Why is it blocked?</button></div>';
    }
    if (rec && status !== 'blocked' && status !== 'executed') {
      h += '<div class="advice"><span class="adv-icon" aria-hidden="true">◇</span><div><b>Agents recommend accepting v' + v + '</b><br>' +
        '<span class="small">Advisory only. It does not count as anyone\'s approval and cannot trigger execution.</span></div></div>';
    }
    h += '<h3>Human approvals <span class="muted small">(3 required)</span></h3>' + approvalRows(v);
    if (status === 'ready') {
      const dis = S.busy ? 'Agents are working' : '';
      h += '<div class="row">' +
        '<button class="btn primary" data-act="approve"' + (myState === 'approved' || dis ? ' disabled' : '') + '>' + (myState === 'approved' ? 'Approved v' + v : 'Approve v' + v) + '</button>' +
        '<button class="btn" data-act="reject"' + (myState === 'rejected' || dis ? ' disabled' : '') + '>Reject</button></div>' +
        '<p class="small muted">Your approval applies only to v' + v + ' under constraints v' + S.cv + '. If terms or constraints change, it stops counting and you will be asked again.</p>' +
        '<details class="will"><summary>What happens when all three approve</summary><ul><li>Change order CO-0042 for ' + E(SFM.itemList(p.items)) + '</li><li>Budget commitment of ' + M(p.cents) + '</li><li>4 tasks for provider, customer and finance</li></ul><p class="small muted">Written once, in one transaction. Internal records only.</p></details>';
    } else if (status === 'blocked') {
      h += '<div class="row"><button class="btn primary" disabled>Approve v' + v + '</button><button class="btn" disabled>Reject</button></div>' +
        '<p class="small muted">Approval is disabled: v' + v + ' fails the rules check under constraints v' + S.cv + '. A new version is being negotiated.</p>';
    } else if (status === 'executed') {
      h += '<p class="small">Executed as ' + S.exec.co + '. <a href="#/room/scope-change/records">See records →</a></p>';
    }
    h += '<h3>Versions</h3><ol class="versions">' + Object.keys(S.proposals).map(function (k) {
      const q = S.proposals[k]; const s = SFM.proposalStatus(+k);
      return '<li' + (+k === v ? ' aria-current="true"' : '') + '><button class="lnk" data-act="goto" data-id="' + q.eventId + '">v' + k + ' · ' + M(q.cents) + ' · ' + SFM.day(q.date) + '</button>' + SFM.pill(SFM.PSTATUS[s] || ['Draft', 'muted']) + '</li>';
    }).join('') + '</ol><button class="btn ghost small" data-act="trace" data-id="' + p.eventId + '">Trace how v' + v + ' came about</button></section>';
    return h;
  }

  function budget() {
    if (S.role !== 'finance') return '';
    const base = S.exec ? S.committed - S.exec.cents : S.committed;
    const p = S.current ? S.proposals[S.current] : null; const add = p ? p.cents : 0;
    const scale = 560000; const pct = function (c) { return (c / scale * 100).toFixed(1) + '%'; };
    const over = base + add > S.cap;
    const canCut = S.cv === 1 && S.stage === 'approval' && !S.busy;
    const why = S.cv !== 1 ? 'Cap is ' + M(S.cap) + ' since constraints v2.' : S.stage !== 'approval' ? 'In this prototype the cut is available while v2 awaits approval.' : '';
    return '<section class="card budget" aria-labelledby="bud-h"><div class="cur-top"><h2 id="bud-h">Budget controls</h2><span class="tag priv">Finance only</span></div>' +
      '<div class="bar" role="img" aria-label="Committed ' + M(base) + ', this proposal ' + M(add) + ', cap ' + M(S.cap) + '">' +
      '<span class="seg c" style="width:' + pct(base) + '"></span><span class="seg p' + (over ? ' over' : '') + '" style="width:' + pct(add) + '"></span>' +
      '<span class="cap" style="left:' + pct(S.cap) + '"></span></div>' +
      '<dl class="nums"><dt>Committed</dt><dd>' + M(base) + '</dd><dt>This proposal</dt><dd>' + M(add) + '</dd><dt>Total</dt><dd class="' + (over ? 'neg' : '') + '">' + M(base + add) + '</dd><dt>Cap</dt><dd>' + M(S.cap) + '</dd><dt>Room sees</dt><dd>' + M(S.cap - base) + ' available</dd></dl>' +
      '<button class="btn warn" data-act="lower-cap"' + (canCut ? '' : ' disabled') + '>Lower cap to ' + M(SFM.BUDGET.lowerTo) + '</button>' +
      '<p class="small muted">' + (why || 'Creates constraints v2. Every open proposal and approval is re-checked; approvals bound to v1 stop counting.') + '</p></section>';
  }

  SFM.aside = function () {
    return '<aside class="aside" aria-label="Current state">' + nextStep() + current() + budget() + '</aside>';
  };
})();

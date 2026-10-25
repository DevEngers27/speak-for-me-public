/* runs.js —— 代理协商运行（run）的模拟。真实系统中由 Convex scheduler + action 调 Claude；
 * 这里用定时器逐步推进，展示：排队 / 进行中 / 校验失败重试 / 最终失败 / 被作废 / 完成。
 * 代理输出必须通过代码校验（价格只能来自已确认报价），否则该次尝试作废。
 */
function turn(role, action, status) { return { role: role, action: action, status: status || 'queued', attempt: 0, max: 3, msg: null, err: null }; }

function startRun(kind, trigger) {
  var run = { id: S.runs.length + 1, kind: kind, trigger: trigger, status: 'running', at: now(), cv: S.cv, turns: [], outcome: null };
  S.runs.push(run);
  ev('run_started', 'room', 'system', { d: (kind === 'initial' ? 'Negotiation' : 'Renegotiation') + ' run #' + run.id + ' started. Trigger: ' + trigger + '.' });
  var steps = kind === 'initial' ? initialSteps(run) : renegotiationSteps(run);
  play(run, steps);
  return run;
}
function retryRun() {
  var r = lastRun();
  if (!r || r.status !== 'failed') return fail('No failed run to retry.');
  ev('run_retried', 'room', 'system', { d: 'Run #' + r.id + ' retried as run #' + (r.id + 1) + '. Nothing was changed by the failed run.' });
  startRun(r.kind === 'initial' && !current() ? 'initial' : 'renegotiation', 'Retry of run #' + r.id);
  return okr('Run restarted.');
}
function play(run, steps) {
  var i = 0;
  function next() {
    if (run.status !== 'running' || i >= steps.length) return;
    if (run.cv !== S.cv) { run.status = 'discarded'; commit(); return; } // 过期结果拒绝写入
    steps[i++]();
    if (FAST) next(); else { commit(); setTimeout(next, STEP_MS); }
  }
  if (FAST) next(); else setTimeout(next, STEP_MS / 2);
}
function setTurn(run, idx, patch) { var t = run.turns[idx]; for (var k in patch) t[k] = patch[k]; if (patch.err) t.errs = (t.errs || []).concat([patch.err]); } // 保留每次失败尝试的记录

function initialSteps(run) {
  return [
    function () { run.turns.push(turn('provider', 'propose', 'running')); run.turns[0].attempt = 1; },
    function () {
      var p = addProposal('Q-1', 'Provider agent (run #' + run.id + ')', run.id);
      setTurn(run, 0, { status: 'done', msg: { d: 'Proposes v' + p.v + ': the full change in one release (quote Q-1).' } });
      run.turns.push(turn('customer', 'reject', 'running'), turn('finance', 'reject', 'queued'));
    },
    function () {
      setTurn(run, 1, { status: 'done', attempt: 1, msg: { d: 'Rejects v1: it misses a delivery limit of my principal.', customer: 'Rejects v1: Dec 4 is after your latest date (Dec 1).' } });
      setTurn(run, 2, { status: 'done', attempt: 1, msg: { d: 'Rejects v1: it exceeds the budget limit.', finance: 'Rejects v1: $5,400 total exceeds your $5,000 cap by $400.' } });
      S.recs.push({ pv: 1, cv: S.cv, role: 'customer', action: 'reject', text: 'Misses a delivery limit.' }, { pv: 1, cv: S.cv, role: 'finance', action: 'reject', text: 'Exceeds the budget limit.' });
      run.turns.push(turn('provider', 'counter', 'running')); run.turns[3].attempt = 1;
    },
    function () {
      var p = addProposal('Q-2', 'Provider agent (run #' + run.id + ')', run.id);
      setTurn(run, 3, { status: 'done', msg: { d: 'Counters with v' + p.v + ': phase 1 (3 modules) by Nov 20, analytics deferred (quote Q-2).' } });
      run.turns.push(turn('customer', 'recommend_accept', 'running'), turn('finance', 'recommend_accept', 'queued'), turn('provider', 'recommend_accept', 'queued'));
    },
    function () {
      var p = current();
      setTurn(run, 4, { status: 'done', attempt: 1, msg: { d: 'Recommends accepting v2. Covers required scope and meets the delivery limit.', customer: 'Recommends accepting v2: Nov 20 matches your target; Role-based permissions included.' } });
      setTurn(run, 5, { status: 'done', attempt: 1, msg: { d: 'Recommends accepting v2. Within the budget limit.', finance: 'Recommends accepting v2: $4,900 of $5,000 cap.' } });
      setTurn(run, 6, { status: 'done', attempt: 1, msg: { d: 'Recommends accepting v2. Matches confirmed quote Q-2.' } });
      recommendAll(p, 'Passes every check under constraints v' + S.cv + '.');
      run.status = 'completed'; run.outcome = 'v' + p.v + ' awaiting human approval';
      ev('run_completed', 'room', 'system', { d: 'Run #' + run.id + ' completed. v' + p.v + ' awaits approval from all three people. Agent recommendations are advisory and do not count as approval.' });
    }
  ];
}

function candidates() {
  var bad = S.proposals.filter(function (p) { return !passes(p, S.cv) || ROLE_KEYS.some(function (r) { return decisionOf(r, p).state === 'rejected'; }); }).map(function (p) { return p.offer; });
  return BRIEFS.provider.offers.filter(function (id) {
    if (bad.indexOf(id) >= 0) return false;
    var o = OFFERS[id];
    return passes({ offer: id, scope: o.scope, cost: o.cost, date: o.date }, S.cv);
  });
}

function renegotiationSteps(run) {
  var forced = S.forceFail;
  var steps = [
    function () { run.turns.push(turn('provider', 'propose', 'running'), turn('customer', 'clarify', 'queued'), turn('finance', 'recommend_accept', 'queued')); run.turns[0].attempt = 1; },
    function () {
      setTurn(run, 0, { status: 'retrying', attempt: 2,
        err: { d: 'Attempt 1 rejected by validator (source.unsourced): the price is not in any confirmed quote.', provider: 'Attempt 1 rejected (source.unsourced): agent offered $700 for 3 modules by Nov 20, which is not a confirmed quote.' } });
      ev('run_turn_retry', 'room', 'system', { d: 'Provider agent output rejected by the validator (unsourced price). Retrying, attempt 2 of 3.' });
    }
  ];
  if (forced) {
    steps.push(function () { setTurn(run, 0, { attempt: 3, err: { d: 'Attempt 2 timed out after 60s. Retrying, attempt 3 of 3.' } }); });
    steps.push(function () {
      setTurn(run, 0, { status: 'failed', err: { d: 'Attempt 3 returned malformed output. Giving up after 3 attempts.' } });
      run.turns.slice(1).forEach(function (t) { t.status = 'skipped'; });
      run.status = 'failed'; run.error = 'agent_failed';
      ev('run_failed', 'room', 'system', { d: 'Run #' + run.id + ' failed after 3 attempts. No proposal, approval or record was changed.' });
    });
    return steps;
  }
  steps.push(function () {
    var c = candidates();
    run.cands = c;
    var label = c.length ? c.map(function (id) { return id; }).join(' and ') : 'none';
    setTurn(run, 0, { status: 'done', msg: { d: c.length ? 'Proposes ' + c.length + ' option(s) from confirmed quotes: ' + label + '.' : 'No confirmed quote fits the current limits.' } });
    setTurn(run, 1, { status: 'running', attempt: 1 });
  });
  steps.push(function () {
    var c = run.cands;
    if (c.length === 2) setTurn(run, 1, { status: 'done', action: 'escalate', msg: { d: 'Both options meet the required scope and limits. The choice depends on my principal’s priorities, so I am asking the Customer.', customer: 'Both options are feasible. Choosing between Nov 20 without Role-based permissions and all 3 modules on Nov 27 needs your call.' } });
    else if (c.length === 1) setTurn(run, 1, { status: 'done', action: 'recommend_accept', msg: { d: 'Only one feasible option. Recommends accepting it.' } });
    else setTurn(run, 1, { status: 'done', action: 'escalate', msg: { d: 'No feasible option. Asking Finance whether a limit can change.' } });
    setTurn(run, 2, { status: 'running', attempt: 1 });
  });
  steps.push(function () {
    var c = run.cands;
    setTurn(run, 2, { status: 'done', action: c.length ? 'recommend_accept' : 'clarify', msg: { d: c.length ? 'Any listed option fits the budget limit.' : 'Current limit cannot fit any confirmed quote.', finance: c.length ? c.map(function (id) { return id + ': ' + money(COMMITTED + OFFERS[id].cost) + ' of ' + money(capNow()); }).join(' · ') : 'Cheapest quote Q-3 needs a cap of at least ' + money(COMMITTED + OFFERS['Q-3'].cost) + '.' } });
    finishRenegotiation(run, c);
  });
  return steps;
}

function finishRenegotiation(run, c) {
  run.status = 'completed';
  if (c.length === 2) {
    var a = OFFERS[c[0]], b = OFFERS[c[1]];
    var rq = { id: 'HR-' + (S.requests.length + 1), target: 'customer', run: run.id, status: 'open', at: now(), title: 'Choose a trade-off: on time with one module fewer, or all modules one week later.',
      question: 'The budget limit now fits only a smaller first phase. Which matters more for the first delivery?',
      options: [
        { id: 'A', kind: 'offer', offer: a.id, title: 'On time, one module fewer', summary: scopeNames(a.scope) + ' · ' + money(a.cost) + ' · ' + dateStr(a.date), tradeoff: 'Role-based permissions moves to phase 2.' },
        { id: 'B', kind: 'offer', offer: b.id, title: 'All 3 modules, one week later', summary: scopeNames(b.scope) + ' · ' + money(b.cost) + ' · ' + dateStr(b.date), tradeoff: 'Misses the Nov 20 target by 7 days; still before the latest date.' }
      ] };
    S.requests.push(rq); run.outcome = 'Decision requested from Customer (' + rq.id + ')';
    ev('human_request_opened', 'room', 'system', { d: 'Run #' + run.id + ' asked the Customer to choose a trade-off (' + rq.id + '). Agents did not pick for them.' });
  } else if (c.length === 1) {
    addProposal(c[0], 'Provider agent (run #' + run.id + ')', run.id);
    recommendAll(current(), 'Only feasible confirmed option under constraints v' + S.cv + '.');
    run.outcome = 'v' + current().v + ' awaiting approval';
    ev('run_completed', 'room', 'system', { d: 'Run #' + run.id + ' completed with v' + current().v + '. It needs fresh approval from all three people.' });
  } else {
    var need = COMMITTED + OFFERS['Q-3'].cost;
    var rq2 = { id: 'HR-' + (S.requests.length + 1), target: 'finance', run: run.id, status: 'open', at: now(), title: 'No confirmed option fits the budget limit. Decide whether to change it.',
      question: 'No confirmed quote fits the current cap. Raise it, or pause the room?',
      options: [ { id: 'A', kind: 'cap', cap: need, title: 'Raise cap to ' + money(need), summary: 'Fits quote Q-3 (lean phase 1).', tradeoff: 'Creates constraints v' + (S.cv + 1) + '.' },
                 { id: 'B', kind: 'pause', title: 'Keep cap, pause the room', summary: 'No proposal can execute.', tradeoff: 'Others will see the room as paused.' } ] };
    S.requests.push(rq2); run.outcome = 'Decision requested from Finance (' + rq2.id + ')';
    ev('human_request_opened', 'room', 'system', { d: 'Run #' + run.id + ' found no feasible option and asked Finance for a decision (' + rq2.id + ').' });
  }
}

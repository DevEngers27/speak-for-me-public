/* components.js — 可复用片段：预算面板（按角色裁剪）、审批面板（代理建议与人的决定分两列）、
 * 代理回合卡（排队/进行中/失败可重试/过期丢弃/完成）、取舍请求卡、检查列表、状态徽章。 */
(function () {
  const F = window.SFM, E = window.ENG, esc = F.esc;
  const R = (r) => F.ROLES[r].label;

  const P_BADGE = {
    executed: ['ok', 'Executed'], superseded: ['', 'Superseded'], blocked: ['danger', 'Blocked'],
    awaiting: ['info', 'Awaiting approvals'], rejected: ['warn', 'Rejected']
  };
  function pBadge(p) { const [c, t] = P_BADGE[E.pStatus(p)]; return '<span class="badge ' + c + '">' + t + '</span>'; }

  const D_BADGE = { approved: ['ok', 'Approved'], rejected: ['danger', 'Rejected'], stale: ['warn', 'Stale: no longer applies'], pending: ['', 'Pending'] };
  function dBadge(st) { const [c, t] = D_BADGE[st]; return '<span class="badge ' + c + '">' + t + '</span>'; }
  const REC = { recommend_accept: 'Recommends accepting', reject: 'Recommends rejecting', counter: 'Countered', propose: 'Proposed' };
  function recBadge(r) { return r ? '<span class="badge agent">Agent: ' + REC[r] + '</span>' : '<span class="muted small">No agent view</span>'; }

  function checksList(role, p) {
    return '<ul class="checks">' + E.evalP(p).map((c) =>
      '<li><span class="mark ' + (c.pass ? 'y">✓' : 'n">✗') + '</span><span>' + esc(F.checkText(role, c)) + ' <code>' + c.code + '</code></span></li>').join('') + '</ul>';
  }

  // 预算面板：finance 全量；customer 看 finance 显式共享的数字；provider 只看 within / exceeds
  function ledgerPanel(role, flash) {
    const S = E.S, c = F.curC(S), acc = F.budgetAccess(role), p = E.latest();
    const live = p && !S.execution && E.pStatus(p) !== 'superseded' ? p : null;
    if (acc === 'limit_only') {
      let verdict = '<span class="badge">No proposal yet</span>';
      if (S.execution) verdict = '<span class="badge ok">Executed within finance limit</span>';
      else if (live) verdict = F.checkTerms(S, live, c)[0].pass ? '<span class="badge ok">v' + live.v + ' is within finance limit</span>' : '<span class="badge danger">v' + live.v + ' exceeds finance limit</span>';
      return '<section class="card" aria-labelledby="bud-h"><div class="cardhead"><h2 id="bud-h">Budget fit</h2><span class="vchip' + (flash ? ' hot' : '') + '">constraints v' + c.v + '</span></div>' +
        '<div class="limitonly">' + verdict + '</div><p class="why">Budget figures are private to Finance. You only see whether a proposal fits the finance limit. Your own offer prices are always visible to you.</p></section>';
    }
    const com = F.committed(S), pend = live && E.pStatus(live) !== 'blocked' ? live.cents : 0;
    const liveCost = live ? live.cents : 0, head = c.capCents - com - liveCost;
    const scale = Math.max(c.capCents, com + liveCost) * 1.05;
    const pct = (x) => (x / scale * 100).toFixed(2) + '%';
    const over = live && head < 0;
    const k = (cls, label, val, d) => '<div class="kpi ' + cls + (flash ? ' flash' : '') + '"><div class="k">' + label + '</div><div class="v">' + val + '</div><div class="d">' + d + '</div></div>';
    return '<section class="card" aria-labelledby="bud-h"><div class="cardhead"><h2 id="bud-h">Budget ledger</h2><span class="vchip' + (flash ? ' hot' : '') + '">constraints v' + c.v + '</span></div>' +
      '<div class="kpis">' +
      k('', 'Cap', F.money(c.capCents), c.v > 1 ? 'was ' + F.money(E.S.constraints[c.v - 2].capCents) : 'set by Finance') +
      k('', 'Committed', F.money(com), S.ledger.length + ' ledger entr' + (S.ledger.length > 1 ? 'ies' : 'y')) +
      k('', 'Pending', F.money(pend), live ? (pend ? 'v' + live.v + ', awaiting approval' : 'v' + live.v + ' is blocked') : S.execution ? 'nothing pending' : 'no proposal yet') +
      k(head < 0 ? 'neg' : '', 'Headroom', F.money(head), live ? 'after v' + live.v : 'cap − committed') + '</div>' +
      '<div class="bar" role="img" aria-label="Committed ' + F.money(com) + ', ' + (live ? 'proposal v' + live.v + ' ' + F.money(liveCost) : 'no proposal') + ', cap ' + F.money(c.capCents) + '">' +
      '<span class="c" style="width:' + pct(com) + '"></span>' + (live ? '<span class="p' + (over ? ' over' : '') + '" style="left:' + pct(com) + ';width:' + pct(liveCost) + '"></span>' : '') +
      '<span class="cap" style="left:' + pct(c.capCents) + '"></span></div>' +
      '<div class="legend"><span><i style="background:#8aa79a"></i>Committed</span><span><i style="background:' + (over ? 'var(--danger)' : 'var(--accent)') + '"></i>Current proposal</span><span><i style="background:var(--ink)"></i>Cap</span></div>' +
      (over ? '<p class="why" style="color:var(--danger)">Over the cap by ' + F.money(-head) + '. v' + live.v + ' cannot execute under constraints v' + c.v + '.</p>' : '') +
      '<p class="why">' + (acc === 'full' ? 'You own these figures. Shared with: Customer. Hidden from: Provider (sees within / exceeds only).' : 'Shared with you by Finance. Provider does not see these figures.') + '</p></section>';
  }

  function approvalsPanel(role, p) {
    if (!p) return '';
    const c = F.curC(E.S);
    const rows = F.ROLE_KEYS.map((r) => {
      const st = E.decision(r, p), ld = E.lastDecision(r, p);
      const note = st === 'stale' ? '<div class="small muted">Given under constraints v' + ld.cv + '</div>' : '';
      return '<div><strong>' + R(r) + (r === role ? ' (you)' : '') + '</strong></div><div class="rec">' + recBadge(p.recs[r]) + '</div><div>' + dBadge(st) + note + '</div>';
    }).join('');
    return '<section class="card" aria-labelledby="ap-h"><div class="cardhead"><h2 id="ap-h">Approvals for v' + p.v + '</h2><span class="vchip">binds v' + p.v + ' + constraints v' + c.v + '</span></div>' +
      '<div class="who"><div class="hd">Party</div><div class="hd rec">Agent (advisory)</div><div class="hd">Human decision</div>' + rows + '</div>' +
      '<p class="why">An agent recommendation is never an approval. Execution needs all three people to approve this exact version under the current constraints.</p></section>';
  }

  const WHO = { provider: 'Provider agent', customer: 'Customer agent', finance: 'Finance agent', rules: 'Rule engine', system: 'System', all: 'All agents' };
  function stepText(st, role) { return typeof st.t === 'string' ? st.t : (st.t[role] || st.t._); }
  function runCard(run, role) {
    if (!run) return '';
    const head = 'Agent run #' + run.n + ' · ' + run.purpose + (run.attempt > 1 ? ' · attempt ' + run.attempt : '');
    const steps = '<ol class="steps">' + run.steps.map((s) => '<li><span class="badge ' + (s.who === 'rules' ? 'info' : s.who === 'system' ? '' : 'agent') + '">' + WHO[s.who] + '</span><span>' + esc(stepText(s, role)) + '</span></li>').join('') + '</ol>';
    if (run.status === 'queued' || run.status === 'running') {
      return '<section class="card run" aria-live="polite"><div class="cardhead"><h2><span class="spinner"></span> ' + head + '</h2><span class="badge agent">' + (run.status === 'queued' ? 'Queued' : 'In progress · round 1 of max 3') + '</span></div>' +
        '<div class="progress"><span style="width:' + Math.round(run.steps.length / run.total * 100) + '%"></span></div>' + steps +
        '<p class="why">Agents exchange public messages only. Private reasoning is not shown or stored. Nothing is written until the run completes under constraints v' + run.startedUnderC + '.</p></section>';
    }
    if (run.status === 'failed') {
      return '<section class="card alert"><div class="cardhead"><h2>' + head + '</h2><span class="badge danger">Failed</span></div>' + steps +
        '<p>' + esc(run.error) + '</p>' + (run.retried ? '<p class="why">Retried as a new attempt.</p>' : '<div class="btnrow"><button class="btn" data-act="retry:' + run.id + '"' + (E.activeRun() ? ' disabled' : '') + '>Retry run</button><span class="why">Retry starts a fresh attempt with the same inputs. No partial proposal exists.</span></div>') + '</section>';
    }
    if (run.status === 'discarded') {
      return '<section class="card attn"><div class="cardhead"><h2>' + head + '</h2><span class="badge warn">Discarded</span></div><p>Constraints changed from v' + run.startedUnderC + ' while this run was working. Its result was thrown away instead of being applied to newer constraints.</p></section>';
    }
    return '<details class="card tight"><summary><strong>' + head + '</strong> <span class="badge ok">Completed</span> <span class="muted small">' + run.steps.length + ' public messages</span></summary>' + steps + '</details>';
  }

  function requestCard(q, role) {
    if (!q) return '';
    const mine = q.target === role;
    const opts = q.options.map((o, i) => {
      if (o.kind === 'raise_cap') return '<div class="opt"><div class="t">Raise the cap to ' + (role === 'finance' ? F.money(o.capCents) : 'the minimum viable amount') + '</div>' + (mine ? '<button class="btn" data-act="answer:' + q.id + ':' + i + '">Raise cap</button><button class="btn secondary" data-act="keepcap:' + q.id + '">Keep current cap</button>' : '') + '</div>';
      const off = F.OFFERS[o.offerId], cur = E.latest();
      const missing = F.SCOPE_ORDER.filter((k) => cur.scope.includes(k) && !off.scope.includes(k));
      const late = F.dayDiff(cur.date, off.date);
      const title = missing.length ? 'On time, one module fewer' : late > 0 ? 'All v' + cur.v + ' modules, ' + late + ' days later' : off.label;
      const give = missing.length ? 'Gives up: ' + missing.map((k) => F.SCOPE[k].label).join(', ') + ' (deferred)' : 'Gives up: ' + (role === 'customer' ? 'your Nov 20 target' : 'the original delivery date');
      return '<div class="opt"><div class="t">' + title + '</div><div class="num">' + F.money(off.cents) + ' · ' + F.fmtDate(off.date) + '</div>' +
        '<div class="small">' + off.scope.map((k) => F.SCOPE[k].label).join(', ') + '</div><div class="give">' + give + '</div>' +
        '<div class="small muted">Source: confirmed offer ' + off.id + ' v' + off.v + '</div>' +
        (mine ? '<button class="btn" data-act="answer:' + q.id + ':' + i + '">Choose this</button>' : '') + '</div>';
    }).join('');
    return '<section class="card attn" aria-labelledby="hr-h"><div class="cardhead"><h2 id="hr-h">' + (mine ? 'Your decision is needed' : 'Waiting on ' + R(q.target)) + '</h2><span class="badge warn">Tradeoff request · constraints v' + q.cv + '</span></div>' +
      '<p>' + esc(q.question) + '</p><div class="options">' + opts + '</div>' +
      '<p class="why">' + (q.options[0].kind === 'raise_cap' ? 'No confirmed offer covers the required scope within this cap. Only Finance can change the cap; keeping it leaves the room blocked.' : mine ? 'Agents could not choose this for you: each option gives up a different preference in your brief. Your answer starts a short agent run that drafts the new version; you still approve it afterwards.' : 'Only ' + R(q.target) + ' can answer. You will be asked to approve the resulting version.') + '</p></section>';
  }

  window.UI = { pBadge, dBadge, recBadge, checksList, ledgerPanel, approvalsPanel, runCard, requestCard, R };
})();

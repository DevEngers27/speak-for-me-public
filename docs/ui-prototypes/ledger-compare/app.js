/* app.js — 外壳：hash 路由、角色切换（仅原型）、房间列表、房间头与标签、原型控制台、事件委托。 */
(function () {
  const F = window.SFM, E = window.ENG, V = window.VIEWS, U = window.UI, esc = F.esc;
  const TABS = [['work', 'Workbench'], ['brief', 'My brief'], ['compare', 'Compare'], ['ledger', 'Ledger'], ['results', 'Results'], ['timeline', 'Timeline']];
  let lastCv = null, flashUntil = 0;

  function route() { const h = location.hash.replace(/^#\/?/, ''); return h.startsWith('room/') ? h.slice(5) : 'rooms'; }
  function go(r) { location.hash = r === 'rooms' ? '#/rooms' : '#/room/' + r; }
  function say(msg) { const l = document.getElementById('live'); l.textContent = msg; const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

  function roleSwitch() {
    const S = E.S;
    document.getElementById('roleswitch').innerHTML = '<span class="proto-tag" title="Real product signs people in with their own accounts">Prototype only</span><span class="small" style="opacity:.8">View as</span><div class="seg" role="group" aria-label="Switch role (prototype only)">' +
      F.ROLE_KEYS.map((r) => '<button data-act="role:' + r + '" aria-pressed="' + (S.role === r) + '">' + F.ROLES[r].label + '</button>').join('') + '</div><span class="small" style="opacity:.8">' + F.ROLES[S.role].person + ' · ' + F.ROLES[S.role].org + '</span>';
  }

  function roomStatus() {
    const S = E.S, p = E.latest();
    if (S.execution) return ['ok', 'Executed'];
    if (E.activeRun()) return ['agent', 'Agents negotiating'];
    if (E.openRequest()) return ['warn', 'Needs input'];
    if (F.ROLE_KEYS.some((r) => S.briefs[r].status !== 'confirmed')) return ['', 'Collecting briefs'];
    if (p && E.pStatus(p) === 'blocked') return ['danger', 'Blocked'];
    if (p) return ['info', 'Pending approval'];
    const lr = S.runs[S.runs.length - 1]; if (lr && lr.status === 'failed') return ['danger', 'Run failed'];
    return ['', 'Negotiating'];
  }

  function rooms(role) {
    const S = E.S, [c, t] = roomStatus(), todo = V.todos(role), p = E.latest();
    const fin = role === 'finance' ? '<span class="num small">' + F.money(F.committed(S)) + ' of ' + F.money(F.curC(S).capCents) + ' committed</span>' : '';
    return '<h1>Rooms</h1><p class="muted">Each room is one decision that needs several parties to agree. You see your own to-dos and what others chose to share.</p><div class="rooms">' +
      '<section class="card roomcard"><div><h2 style="margin-bottom:4px"><a href="#/room/work">Analytics portal: scope change</a> <span class="badge warn">simulated</span></h2>' +
      '<div class="small muted">Customer · Provider · Finance &nbsp;·&nbsp; <span class="vchip">' + (p ? 'proposal v' + p.v : 'no proposal') + '</span> <span class="vchip">constraints v' + F.curC(S).v + '</span> ' + fin + '</div>' +
      (todo.length ? '<div style="margin-top:6px"><span class="badge warn">Your turn: ' + esc(todo[0][0]) + '</span></div>' : '<div class="small muted" style="margin-top:6px">Nothing waiting on you.</div>') +
      '</div><div style="text-align:right"><span class="badge ' + c + '">' + t + '</span><div style="margin-top:8px"><button class="btn" data-act="go:work">Open</button></div></div></section>' +
      '<section class="card roomcard disabled"><div><h2 style="margin-bottom:4px">Support retainer renewal <span class="badge warn">simulated</span></h2><div class="small muted">Customer · Provider · Finance · not interactive in this prototype</div></div><span class="badge">Collecting briefs</span></section>' +
      '<section class="card roomcard disabled"><div><h2 style="margin-bottom:4px">Brand refresh SOW <span class="badge warn">simulated</span></h2><div class="small muted">Executed 3 weeks ago · not interactive in this prototype</div></div><span class="badge ok">Executed</span></section></div>';
  }

  function roomFrame(role, tab, body) {
    const S = E.S, [c, t] = roomStatus(), p = E.latest(), cv = F.curC(S).v;
    const dots = { work: V.todos(role).length > 0, results: !!S.execution };
    return '<div class="crumb"><a href="#/rooms">Rooms</a> / Analytics portal: scope change</div>' +
      '<div class="roomhead"><div><h1>Analytics portal: scope change</h1><div class="muted small">Shared goal: add SSO, audit export and reporting to the client portal without breaking the FY26 budget.</div></div>' +
      '<div class="meta"><span class="badge ' + c + '">' + t + '</span><span class="vchip">' + (p ? 'Proposal v' + p.v : 'No proposal') + '</span><span class="vchip' + (cv > 1 && !S.execution ? ' hot' : '') + '">Constraints v' + cv + '</span><span class="small muted">Viewing as <strong>' + F.ROLES[role].label + '</strong></span></div></div>' +
      '<nav class="tabs" aria-label="Room sections">' + TABS.map(([k, l]) => '<a href="#/room/' + k + '"' + (k === tab ? ' aria-current="page"' : '') + '>' + l + (dots[k] && k !== tab ? '<span class="dot" aria-label="has updates"></span>' : '') + '</a>').join('') + '</nav>' + body;
  }

  // 下一步提示：方便演示者按剧本走（不是产品功能）
  function nextStep() {
    const S = E.S, p = E.latest(), q = E.openRequest(), lr = S.runs[S.runs.length - 1];
    if (S.briefs.customer.status === 'draft') return ['Customer confirms their brief', 'customer', 'brief'];
    if (E.activeRun()) return ['Watch the agent run on the Workbench', null, 'work'];
    if (lr && lr.status === 'failed' && !lr.retried) return ['Retry the failed run', null, 'work'];
    if (q) return [F.ROLES[q.target].label + ' answers the request', q.target, 'work'];
    if (S.execution) return ['Inspect results and the ledger', null, 'results'];
    if (p && E.pStatus(p) === 'awaiting') {
      const pending = F.ROLE_KEYS.filter((r) => E.decision(r, p) !== 'approved');
      if (F.curC(S).v === 1 && pending.length === 1 && pending[0] === 'finance') return ['Key moment: Finance lowers the cap to $4,800 instead of approving', 'finance', 'ledger'];
      return [F.ROLES[pending[0]].label + ' approves v' + p.v, pending[0], 'work'];
    }
    return ['Explore', null, 'work'];
  }

  function proto() {
    const S = E.S, [txt, r, tab] = nextStep();
    const open = (() => { try { return localStorage.getItem('sfm-proto-open') === '1'; } catch (e) { return true; } })();
    document.getElementById('proto').innerHTML = '<details class="protopanel"' + (open ? ' open' : '') + ' id="protod"><summary>Prototype controls <span class="muted">(not product UI)</span><div class="small" style="font-weight:400;margin:2px 0 0 14px">Next: ' + esc(txt) + '</div></summary>' +
      '<div class="row"><span><strong>Next:</strong> ' + esc(txt) + '</span><button data-act="guide:' + (r || '') + ':' + tab + '">Go</button></div>' +
      '<div class="row"><label><input type="checkbox" data-act="failnext"' + (S.failNextRun ? ' checked' : '') + '> Fail the next agent run</label></div>' +
      '<div class="row"><button data-act="dup"' + (S.execution ? '' : ' disabled') + '>Re-send final approval (duplicate)</button></div>' +
      '<div class="row"><button data-act="reset">Reset scenario</button><span class="muted">State is kept in this browser only.</span></div></details>';
  }

  function render() {
    const S = E.S, r = route(), role = S.role;
    const cv = F.curC(S).v;
    if (lastCv !== null && cv !== lastCv) flashUntil = Date.now() + 1500;
    lastCv = cv;
    const flash = Date.now() < flashUntil;
    roleSwitch();
    const app = document.getElementById('app');
    const tab = TABS.some(([k]) => k === r) ? r : null;
    app.innerHTML = !tab ? rooms(role) : roomFrame(role, tab, ({ work: V.workbench, brief: V.brief, compare: V.compare, ledger: V.ledger, results: V.results, timeline: V.timeline })[tab](role, flash));
    proto();
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]'); if (!el) return;
    const [a, b, c] = el.getAttribute('data-act').split(':');
    if (el.tagName === 'INPUT' && el.type === 'checkbox' && a !== 'share' && a !== 'task' && a !== 'failnext') return;
    const S = E.S;
    switch (a) {
      case 'role': S.role = b; E.changed(); say('Now viewing as ' + F.ROLES[b].label + ' (prototype only)'); break;
      case 'go': ev.preventDefault(); go(b); break;
      case 'scroll': { const t = document.getElementById(b); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' }); break; }
      case 'confirm-brief': E.confirmBrief(); say('Brief v1 confirmed'); break;
      case 'share': E.toggleShare(b); break;
      case 'approve': case 'reject': case 'withdraw': E.decide(a, Number(b)); say('Recorded: ' + a + ' v' + b); break;
      case 'retry': E.retryRun(b); say('Retrying run'); break;
      case 'answer': E.answer(b, Number(c)); say('Answer recorded'); break;
      case 'keepcap': E.keepCap(b); break;
      case 'cap-submit': {
        const v = Math.round(Number(document.getElementById('capInput').value) * 100);
        const err = E.changeCap(v, document.getElementById('capReason').value);
        if (err) { document.getElementById('capErr').textContent = err; } else say('Constraints updated');
        break;
      }
      case 'cmp': ev.preventDefault(); S.compare = { a: Number(b), b: Number(c) }; E.changed(); go('compare'); break;
      case 'tl': S.timelineFilter = b; E.changed(); break;
      case 'task': E.toggleTask(b); break;
      case 'failnext': S.failNextRun = el.checked; E.changed(); break;
      case 'dup': E.duplicate(); say('Duplicate request ignored'); break;
      case 'reset': if (confirm('Reset the simulated scenario?')) { E.reset(); go('rooms'); } break;
      case 'guide': if (b) S.role = b; E.changed(); go(c); break;
    }
  });
  document.addEventListener('change', (ev) => {
    const w = ev.target.getAttribute && ev.target.getAttribute('data-cmp'); if (!w) return;
    E.S.compare[w] = Number(ev.target.value); E.changed();
  });
  document.addEventListener('toggle', (ev) => { if (ev.target.id === 'protod') { try { localStorage.setItem('sfm-proto-open', ev.target.open ? '1' : '0'); } catch (e) {} } }, true);
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  E.init(render);
  if (!location.hash) location.hash = '#/rooms';
  render();
})();

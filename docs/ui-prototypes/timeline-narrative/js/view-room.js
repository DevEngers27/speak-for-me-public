// 房间页：头部、章节导轨（左）、叙事时间线（中）。右侧摘要卡在 view-aside.js。
(function () {
  const S = SFM.S; const E = SFM.esc;

  SFM.STAGE = {
    briefs: ['Waiting for briefs', 'muted'], negotiating: ['Agents negotiating', 'run'], approval: ['Pending approval', 'ask'],
    renegotiating: ['Renegotiating', 'run'], run_failed: ['Agent round failed', 'bad'], awaiting_tradeoff: ['Needs input', 'ask'],
    approval2: ['Pending approval', 'ask'], executed: ['Executed', 'ok']
  };
  SFM.PSTATUS = { ready: ['Ready for approval', 'ask'], blocked: ['Blocked', 'bad'], superseded: ['Superseded', 'muted'], executed: ['Executed', 'ok'], checking: ['Checking', 'run'] };

  function pill(t) { return '<span class="pill ' + t[1] + '">' + E(t[0]) + '</span>'; }
  SFM.pill = pill;
  function tag(t) { return '<span class="tag ' + t[0] + '">' + E(t[1]) + '</span>'; }

  SFM.roomHeader = function (tab) {
    const st = SFM.STAGE[S.stage];
    const tabs = [['timeline', 'Timeline', '#/room/scope-change'], ['brief', 'My private brief', '#/room/scope-change/brief'], ['records', 'Records', '#/room/scope-change/records']];
    return '<section class="room-head">' +
      '<a class="back" href="#/rooms">← All rooms</a>' +
      '<div class="rh-row"><div><h1>Loyalty launch scope change</h1>' +
      '<p class="muted">Agree on scope, price and delivery for the loyalty-program change request · Larkspur Supply Co. × Kitebridge Studio</p></div>' +
      '<div class="rh-meta">' + pill(st) + '<span class="ver">Proposal v' + (S.current || '–') + ' · Constraints v' + S.cv + '</span><span class="tag sim">Simulated</span></div></div>' +
      '<nav class="tabs" aria-label="Room sections">' + tabs.map(function (t) {
        return '<a href="' + t[2] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
      }).join('') + '</nav></section>';
  };

  function visible(ev) { return ev.vis === 'room' || ev.vis === S.role; }
  function matches(ev) {
    const f = S.filter; const t = ev.actor.type;
    if (f === 'all') return true;
    if (f === 'human') return t === 'human';
    if (f === 'agent') return t === 'agent' || ev.kind === 'agent_context' || ev.kind === 'run_failed';
    if (f === 'rules') return t === 'code' || ev.kind === 'constraint_change';
    if (f === 'private') return ev.vis === S.role || (ev.kind === 'brief_confirmed' && ev.who === S.role);
    return true;
  }
  function defaultOpen(ev) {
    if (ev.kind === 'run') return S.runs[ev.runId].status !== 'done';
    if (ev.kind === 'tradeoff') return !S.tradeoff.answer;
    return ev.kind === 'blocked' || ev.kind === 'run_failed' || ev.kind === 'execution';
  }
  function isOpen(ev) { return S.expanded[ev.id] != null ? S.expanded[ev.id] : defaultOpen(ev); }

  function runBody(r) {
    const live = r.status === 'running' || r.status === 'retrying';
    const label = { running: 'In progress', retrying: 'Retrying', failed: 'Failed', needs_input: 'Waiting for a person', done: 'Completed' }[r.status];
    return '<div class="run st-' + r.status + '"><div class="run-status">' + (live ? '<span class="spin" aria-hidden="true"></span>' : '') +
      '<b>' + label + '</b>' + (r.attempt > 1 || r.status === 'retrying' || r.status === 'failed' ? ' · attempt ' + r.attempt + ' of ' + r.max : '') +
      (live ? ' · <span class="muted">turns are bounded; outputs are validated before anyone sees them</span>' : '') + '</div>' +
      '<ol class="steps">' + r.steps.map(function (s) {
        const d = s.detail && s.detail[S.role];
        return '<li class="s-' + s.state + '"><span class="st" aria-hidden="true">' + (s.state === 'fail' ? '✕' : s.state === 'active' ? '…' : '✓') + '</span>' +
          '<span><span class="t">' + s.t.slice(8) + '</span> ' + E(s.text) + (d ? '<span class="detail"><span class="tag priv">Only you</span> ' + E(d) + '</span>' : '') + '</span></li>';
      }).join('') + '</ol></div>';
  }

  function tradeoffBody(t) {
    const me = S.role; const canAnswer = me === 'customer' && !t.answer;
    return '<div class="options">' + t.options.map(function (o) {
      const chosen = t.answer === o.key; const lines = SFM.optionDetail(o, me);
      return '<div class="option' + (chosen ? ' chosen' : '') + (t.answer && !chosen ? ' faded' : '') + '">' +
        '<h4>' + E(o.title) + (chosen ? ' <span class="pill ok">Chosen</span>' : '') + '</h4>' +
        '<p class="opt-terms">' + E(lines[0]) + '</p><ul>' + lines.slice(1).map(function (l) {
          return '<li class="' + (l[0] === '+' ? 'pro' : l[0] === '−' ? 'con' : 'neu') + '">' + E(l) + '</li>'; }).join('') + '</ul>' +
        (canAnswer ? '<button class="btn primary" data-act="answer" data-key="' + o.key + '">Choose this option</button>' : '') + '</div>';
    }).join('') + '</div>' +
      (canAnswer ? '<p class="muted small">Both options use confirmed quotes. Your answer becomes a recorded decision; the resulting proposal still needs approval from all three people.</p>' :
        (!t.answer ? '<p class="muted small">Only Avery can answer this request. You will be asked to approve whatever proposal follows.</p>' : ''));
  }

  function linkList(label, evs) {
    const vis = evs.filter(visible);
    if (!vis.length) return '';
    return '<div class="links"><span class="muted">' + label + '</span>' + vis.map(function (e) {
      return '<button class="lnk" data-act="goto" data-id="' + e.id + '">' + E(SFM.describe(e, S.role).title) + '</button>';
    }).join('') + '</div>';
  }

  function node(ev) {
    const d = SFM.describe(ev, S.role); const open = isOpen(ev);
    const hl = S.hl ? (S.hl.set[ev.id] ? ' hl' : ' dim') : '';
    const runPill = d.run ? ' ' + pill([{ running: 'Running', retrying: 'Retrying', failed: 'Failed', needs_input: 'Needs a person', done: 'Done' }[d.run.status], d.run.status === 'done' ? 'muted' : d.run.status === 'failed' ? 'bad' : d.run.status === 'needs_input' ? 'ask' : 'run']) : '';
    const statusPill = d.status && SFM.PSTATUS[d.status] ? ' ' + pill(SFM.PSTATUS[d.status]) : '';
    let body = '';
    if (open) {
      body += d.body || '';
      if (d.run) body += runBody(d.run);
      if (d.tradeoff) body += tradeoffBody(d.tradeoff);
      if (d.retry) body += '<button class="btn primary" data-act="retry">Retry negotiation</button>';
      body += linkList('Because of:', ev.causes.map(SFM.ev).filter(Boolean));
      body += linkList('Led to:', SFM.children(ev.id));
      body += '<button class="btn ghost small" data-act="trace" data-id="' + ev.id + '">Trace why this happened</button>';
    }
    return '<li class="node a-' + ev.actor.type + ' k-' + ev.kind + hl + '" id="n-' + ev.id + '">' +
      '<span class="dot" aria-hidden="true"></span><article class="card">' +
      '<div class="meta"><span class="time">' + E(ev.time) + '</span><span class="actor">' + E(SFM.actorLabel(ev, S.role)) + '</span>' + d.tags.map(tag).join('') + '</div>' +
      '<button class="ntitle" data-act="toggle" data-id="' + ev.id + '" aria-expanded="' + open + '"><span class="chev" aria-hidden="true">' + (open ? '▾' : '▸') + '</span>' + E(d.title) + runPill + statusPill + '</button>' +
      (d.sub ? '<p class="sub">' + E(d.sub) + '</p>' : '') +
      (open && body ? '<div class="nbody">' + body + '</div>' : '') + '</article></li>';
  }

  function phaseLabel(id) { return SFM.PHASES.find(function (p) { return p.id === id; }).label; }

  SFM.rail = function () {
    const seen = {}; S.events.filter(visible).forEach(function (e) { seen[e.phase] = true; });
    const last = S.events[S.events.length - 1].phase;
    return '<nav class="rail" aria-label="Story chapters"><h3>Story so far</h3><ol>' + SFM.PHASES.map(function (p) {
      const st = p.id === last ? 'now' : seen[p.id] ? 'done' : 'todo';
      return '<li class="' + st + '">' + (seen[p.id] ? '<button class="lnk" data-act="chapter" data-phase="' + p.id + '">' + p.label + '</button>' : '<span>' + p.label + '</span>') +
        (st === 'now' ? '<span class="sr-only"> (current)</span>' : '') + '</li>';
    }).join('') + '</ol>' +
      '<div class="legend"><h3>Legend</h3><p><span class="lg a-human"></span>Human decision</p><p><span class="lg a-agent"></span>Agent (advisory)</p><p><span class="lg a-code"></span>Rules engine</p><p><span class="lg a-system"></span>System</p></div></nav>';
  };

  SFM.timeline = function () {
    const evs = S.events.filter(visible).filter(matches);
    const chips = [['all', 'Everything'], ['human', 'Human decisions'], ['agent', 'Agent activity'], ['rules', 'Rules & constraints'], ['private', 'Private to me']];
    let html = '<section class="timeline" aria-label="Room timeline">' +
      '<div class="tl-tools"><div class="chips" role="group" aria-label="Filter timeline">' + chips.map(function (c) {
        return '<button class="chip" data-act="filter" data-f="' + c[0] + '" aria-pressed="' + (S.filter === c[0]) + '">' + c[1] + '</button>';
      }).join('') + '</div><div class="tl-btns"><button class="btn ghost small" data-act="expand-all">Expand all</button><button class="btn ghost small" data-act="collapse-all">Collapse all</button></div></div>';
    if (S.hl) {
      html += '<div class="trace-banner" role="status"><b>Tracing:</b> ' + E(S.hl.label) + ' · ' + Object.keys(S.hl.set).length +
        ' linked events highlighted <button class="btn small" data-act="clear-trace">Clear</button></div>';
    }
    let cur = null; let open = false;
    evs.forEach(function (ev) {
      if (ev.phase !== cur) {
        if (open) html += '</ol>';
        cur = ev.phase; open = true;
        html += '<h2 class="chapter" id="ch-' + cur + '">' + E(phaseLabel(cur)) + '</h2><ol class="nodes">';
      }
      html += node(ev);
    });
    if (open) html += '</ol>';
    if (!evs.length) html += '<p class="empty">No events match this filter.</p>';
    if (S.busy) html += '<p class="typing"><span class="spin" aria-hidden="true"></span> Agents are working. New events will appear here.</p>';
    return html + '</section>';
  };

  SFM.roomPage = function () {
    return SFM.roomHeader('timeline') + '<div class="room-grid">' + SFM.rail() + SFM.timeline() + SFM.aside() + '</div>';
  };
})();

// 路由（hash）、渲染、事件委托、角色切换（仅原型）、原型控制面板。
(function () {
  const S = SFM.S;
  let pendingScroll = null;

  function route() {
    const h = location.hash || '#/rooms';
    if (h.indexOf('#/room/scope-change/brief') === 0) return 'brief';
    if (h.indexOf('#/room/scope-change/records') === 0) return 'records';
    if (h.indexOf('#/room/scope-change') === 0) return 'room';
    return 'rooms';
  }

  SFM.render = function () {
    const app = document.getElementById('app');
    const r = route();
    const y = window.scrollY;
    app.innerHTML = r === 'room' ? SFM.roomPage() : r === 'brief' ? SFM.briefPage() : r === 'records' ? SFM.recordsPage() : SFM.roomsPage();
    window.scrollTo(0, y);
    document.querySelectorAll('[data-role]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.role === S.role)); });
    document.querySelectorAll('[data-nav]').forEach(function (a) { a.toggleAttribute('aria-current', r === 'rooms'); });
    renderPanel();
    if (S.flash) {
      let t = document.querySelector('.toast');
      if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
      t.textContent = S.flash; t.classList.add('show');
      clearTimeout(SFM._tt); SFM._tt = setTimeout(function () { t.classList.remove('show'); }, 3200);
      S.flash = null;
    }
    if (pendingScroll) { const el = document.getElementById(pendingScroll); pendingScroll = null; if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('pulse'); } }
  };

  function goto(id) {
    if (route() !== 'room') { location.hash = '#/room/scope-change'; }
    S.expanded[id] = true; pendingScroll = 'n-' + id;
    if (S.filter !== 'all') S.filter = 'all';
    SFM.render();
  }

  function trace(id) {
    const set = SFM.ancestors(id); const ev = SFM.ev(id);
    S.hl = { target: id, set: set, label: SFM.describe(ev, S.role).title };
    S.filter = 'all';
    Object.keys(set).forEach(function (k) { S.expanded[k] = S.expanded[k] || false; });
    S.expanded[id] = true;
    pendingScroll = 'n-' + id;
    SFM.render();
  }

  document.addEventListener('click', function (e) {
    const roleBtn = e.target.closest('[data-role]');
    if (roleBtn) { S.role = roleBtn.dataset.role; S.hl = null; SFM.say('Now viewing as ' + SFM.PEOPLE[S.role].name + ' (' + SFM.ROLE_LABEL[S.role] + '). Prototype only.'); SFM.render(); return; }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act; const id = el.dataset.id;
    if (act === 'task') return; // 由 change 事件处理
    if (el.tagName === 'A') return;
    e.preventDefault();
    if (act === 'toggle') { const ev = SFM.ev(id); const open = el.getAttribute('aria-expanded') === 'true'; S.expanded[ev.id] = !open; SFM.render(); }
    else if (act === 'filter') { S.filter = el.dataset.f; SFM.render(); }
    else if (act === 'expand-all') { S.events.forEach(function (x) { S.expanded[x.id] = true; }); SFM.render(); }
    else if (act === 'collapse-all') { S.events.forEach(function (x) { S.expanded[x.id] = false; }); SFM.render(); }
    else if (act === 'goto') goto(id);
    else if (act === 'trace') trace(id);
    else if (act === 'trace-go') { location.hash = '#/room/scope-change'; setTimeout(function () { trace(id); }, 0); }
    else if (act === 'clear-trace') { S.hl = null; SFM.render(); }
    else if (act === 'chapter') { const h = document.getElementById('ch-' + el.dataset.phase); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (act === 'approve') SFM.decide(S.role, 'approved');
    else if (act === 'reject') SFM.decide(S.role, 'rejected');
    else if (act === 'confirm-brief') { if (route() !== 'room') location.hash = '#/room/scope-change'; SFM.confirmBrief(); }
    else if (act === 'lower-cap') SFM.lowerCap();
    else if (act === 'answer') SFM.answerTradeoff(el.dataset.key);
    else if (act === 'retry') SFM.retryRun();
    else if (act === 'p-reset') { SFM.reset(); SFM.say('Scenario reset.'); SFM.render(); }
    else if (act === 'p-jump') SFM.jumpToCut();
    else if (act === 'p-dup') SFM.duplicateExecute();
    else if (act === 'p-speed') { S.speed = +el.dataset.v; SFM.render(); }
    else if (act === 'p-toggle') { S.panelOpen = !S.panelOpen; renderPanel(); }
  });

  document.addEventListener('change', function (e) {
    const el = e.target;
    if (el.dataset && el.dataset.act === 'task') SFM.toggleTask(el.dataset.id);
    if (el.id === 'p-fail') { S.forceFail = el.checked; renderPanel(); }
  });

  // 原型控制面板：明确标注不属于产品。
  function renderPanel() {
    const p = document.getElementById('proto-panel');
    if (!S.panelOpen) { p.innerHTML = '<button class="btn small" data-act="p-toggle" aria-expanded="false">Prototype controls</button>'; return; }
    p.innerHTML = '<div class="pp"><div class="cur-top"><b>Prototype controls</b><button class="btn small ghost" data-act="p-toggle" aria-expanded="true">Close</button></div>' +
      '<p class="small muted">Not part of the product. Helpers for reviewing the flow.</p>' +
      '<p class="small">Agent speed: ' + [[1, 'Normal'], [3, 'Fast'], [0, 'Instant']].map(function (s) {
        return '<button class="chip" data-act="p-speed" data-v="' + s[0] + '" aria-pressed="' + (S.speed === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</p>' +
      '<label class="small"><input type="checkbox" id="p-fail"' + (S.forceFail ? ' checked' : '') + '> Force the next renegotiation round to fail 3 times</label>' +
      '<div class="row"><button class="btn small" data-act="p-jump">Jump to the budget-cut moment</button>' +
      '<button class="btn small" data-act="p-dup"' + (S.exec ? '' : ' disabled') + '>Send duplicate execute request</button>' +
      '<button class="btn small warn" data-act="p-reset">Reset scenario</button></div></div>';
  }

  window.addEventListener('hashchange', function () { S.hl = S.hl && route() === 'room' ? S.hl : null; window.scrollTo(0, 0); SFM.render(); document.getElementById('app').focus({ preventScroll: true }); });

  SFM.reset();
  SFM.render();
})();

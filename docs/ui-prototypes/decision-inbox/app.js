// 路由与事件委托。hash 路由，file:// 下可用。
(function () {
  const S = window.SFM, V = window.V;
  const root = document.getElementById('app');
  let lastHash = null, toastTimer = null, lastToastId = null;

  function route() {
    const h = (location.hash || '#/inbox').replace(/^#\/?/, '');
    return h.split('/').filter(Boolean);
  }

  function page(P, r) {
    const [a, b] = r;
    if (a === 'rooms') return V.rooms(P);
    if (a === 'room') {
      if (!b) return V.roomOverview(P);
      if (b === 'proposals') return V.roomProposals(P);
      if (b === 'brief') return V.roomBrief(P);
      if (b === 'budget') return V.roomBudget(P);
      if (b === 'results') return V.roomResults(P);
      if (b === 'timeline') return V.roomTimeline(P);
    }
    if (a === 'decide') {
      if (b === 'brief') return V.decideBrief(P);
      if (b === 'approve') return V.decideApprove(P);
      if (b === 'tradeoff') return V.decideTradeoff(P);
    }
    return V.inbox(P);
  }

  function render() {
    const st = S.get();
    const P = window.SFMProject(st, st.role);
    const r = route();
    // 保留文本框焦点与光标（代理回合的定时刷新不应打断输入）
    const active = document.activeElement;
    const keep = active && active.id ? { id: active.id, s: active.selectionStart, e: active.selectionEnd } : null;
    root.innerHTML = V.protoBar(P) + V.appHead(P, r) + `<main id="main">${page(P, r)}</main>` + V.toast(st);
    if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* 非文本输入 */ } } }
    if (location.hash !== lastHash) { lastHash = location.hash; window.scrollTo(0, 0); }
    if (st.toast && st.toast.id !== lastToastId) {
      lastToastId = st.toast.id; clearTimeout(toastTimer);
      toastTimer = setTimeout(() => S.clearToast(), 3800);
    }
  }

  const go = h => { location.hash = h; };

  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    if (el.type === 'checkbox') return; // 复选框走 change 事件
    switch (act) {
      case 'role': V.ui.pick = null; S.setRole(el.dataset.role); break;
      case 'cut': S.jumpToCut(); break;
      case 'reset': if (window.confirm('Reset the simulated scenario to the start?')) { V.ui.pick = null; V.ui.note = ''; S.reset(); go('#/inbox'); } break;
      case 'fitem': S.setFinanceItem(el.dataset.key, el.dataset.status); break;
      case 'confirmbrief': S.confirmFinanceBrief(); if (S.get().briefV.finance > 0) go('#/inbox'); break;
      case 'approve': S.approve(+el.dataset.v); break;
      case 'reject': S.say('Rejecting isn’t simulated here. In the product it asks for a reason and starts a new agent round.', 'info'); break;
      case 'pick': V.ui.pick = el.dataset.offer; render(); break;
      case 'answer': if (V.ui.pick) { S.answerTradeoff(V.ui.pick, V.ui.note.trim()); V.ui.pick = null; V.ui.note = ''; go('#/inbox'); } break;
      case 'retry': S.retryRun(); break;
      case 'lowercap': {
        const v = parseFloat(document.getElementById('newcap').value);
        const reason = document.getElementById('capreason').value.trim();
        const cents = Math.round(v * 100);
        const st = S.get();
        if (!isFinite(v)) { S.say('Enter a number for the new cap.', 'warn'); break; }
        if (cents < st.committed) { S.say('The cap can’t go below what is already committed ($4,000).', 'warn'); break; }
        if (cents === st.cap) { S.say('That is the current cap — nothing to change.', 'warn'); break; }
        S.lowerCap(cents, reason);
        break;
      }
      case 'dup': S.duplicateExecute(); break;
      case 'filter': V.ui.filter = el.dataset.f; render(); break;
    }
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'failnext') S.toggleFailNext();
    if (el.dataset.act === 'fshare') S.toggleFinanceShare(el.dataset.key);
    if (el.dataset.act === 'task') S.toggleTask(el.dataset.id);
  });

  root.addEventListener('input', (ev) => {
    if (ev.target.dataset && ev.target.dataset.input === 'note') V.ui.note = ev.target.value;
  });

  window.addEventListener('hashchange', render);
  S.subscribe(render);
  render();
})();

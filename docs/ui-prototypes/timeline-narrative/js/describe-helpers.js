// 投影辅助函数：校验结果、条款表、取舍选项（按查看者角色裁剪）。
// 事件 → 按查看者角色裁剪后的文本。
// 这模拟服务端的"披露投影"：同一事件，finance 看到预算算式，其他人只看到 finance 授权共享的"可用额度"。
(function () {
  const S = SFM.S; const P = SFM.PEOPLE; const M = SFM.money; const D = SFM.day; const E = SFM.esc;

  function who(role, me) { return role === me ? 'You' : P[role].name + ' (' + SFM.ROLE_LABEL[role] + ')'; }
  function whoShort(role, me) { return role === me ? 'You' : P[role].short; }
  SFM.who = who;

  SFM.actorLabel = function (ev, me) {
    const a = ev.actor || {};
    if (a.type === 'human') return who(a.role, me);
    if (a.type === 'agent') return a.role ? SFM.ROLE_LABEL[a.role] + ' agent' : 'Agents';
    if (a.type === 'code') return 'Rules engine';
    return 'System';
  };

  // 单条校验结果的投影
  SFM.checkLine = function (r, me) {
    if (r.rule === 'budget') {
      if (me === 'finance') {
        return (r.pass ? 'Within budget: ' : 'Over budget: ') + M(r.total - r.cents) + ' committed + ' + M(r.cents) + ' = ' + M(r.total) +
          (r.pass ? ' ≤ cap ' : ' > cap ') + M(r.cap) + (r.pass ? '' : ' (over by ' + M(r.total - r.cap) + ')');
      }
      return (r.pass ? 'Within budget: ' : 'Over budget: ') + M(r.cents) + (r.pass ? ' ≤ ' : ' > ') + M(r.avail) +
        ' available for this change (shared by finance)' + (r.pass ? '' : ', over by ' + M(r.cents - r.avail));
    }
    if (r.rule === 'scope') return r.pass ? 'Required scope: includes Loyalty points API and Checkout integration' : 'Required scope: missing a required module';
    if (r.rule === 'deadline') {
      if (me === 'customer') return (r.pass ? 'Deadline met: ' : 'Deadline missed: ') + D(r.date) + (r.pass ? ' is on or before ' : ' is after ') + 'your deadline ' + D(r.deadline);
      return r.pass ? "Deadline: meets a participant's private deadline (value not shared)" : "Deadline: misses a participant's private deadline (value not shared)";
    }
    if (r.rule === 'source') return r.pass ? 'Source: price and date match confirmed quote ' + r.quote + ' (simulated)' : 'Source: price or date not found in a confirmed quote';
    return r.rule;
  };

  function checkList(chk, me) {
    return '<ul class="checks">' + chk.results.map(function (r) {
      return '<li class="' + (r.pass ? 'pass' : 'fail') + '"><span class="ck" aria-hidden="true">' + (r.pass ? '✓' : '✕') + '</span>' +
        '<span class="sr-only">' + (r.pass ? 'Pass' : 'Fail') + ': </span>' + E(SFM.checkLine(r, me)) + '</li>';
    }).join('') + '</ul>';
  }
  SFM.checkList = checkList;

  SFM.termsTable = function (p, me) {
    let rows = '<tr><th>Scope</th><td>' + E(SFM.itemList(p.items)) + '</td></tr>' +
      '<tr><th>Deferred</th><td>' + (p.deferred.length ? E(SFM.itemList(p.deferred)) + ' (later phase)' : 'Nothing') + '</td></tr>' +
      '<tr><th>Added cost</th><td>' + M(p.cents) + '</td></tr>' +
      '<tr><th>Delivery</th><td>' + D(p.date) + '</td></tr>' +
      '<tr><th>Source</th><td>Quote ' + p.quote + ' · ' + E(SFM.QUOTES[p.quote].label) + ' <span class="tag sim">simulated</span></td></tr>';
    if (me === 'finance' && SFM.proposalStatus(p.v) !== 'superseded') rows += '<tr><th>Total after</th><td>' + M(S.committed + (S.exec && S.exec.v === p.v ? 0 : p.cents)) + ' of cap ' + M(S.cap) + ' <span class="tag priv">Finance only</span></td></tr>';
    return '<table class="terms">' + rows + '</table>';
  };

  function optionDetail(o, me) {
    const q = SFM.QUOTES[o.quote]; const avail = S.cap - (S.exec ? S.committed - S.exec.cents : S.committed);
    const lines = [];
    lines.push(SFM.itemList(q.items) + ' · ' + M(q.cents) + ' · delivery ' + D(q.date));
    if (o.key === 'on_time') {
      lines.push(me === 'customer' ? '+ Meets your Nov 20 deadline' : "+ Meets every participant's deadline");
      lines.push(me === 'customer' ? '− Receipt emails move to a later phase (your preference)' : '− Receipt emails move to a later phase');
    } else {
      lines.push('+ Keeps all three phase-1 modules');
      lines.push(me === 'customer' ? '− One week after your Nov 20 deadline. Choosing this updates your private deadline to Nov 27 (new constraints version).' : "− Misses a participant's private deadline unless they change it");
    }
    if (me === 'finance') lines.push('Total after: ' + M(SFM.BUDGET.committed + q.cents) + ' of cap ' + M(S.cap) + (SFM.BUDGET.committed + q.cents === S.cap ? ' (exactly at cap)' : ''));
    else lines.push(M(q.cents) + ' of ' + M(avail) + ' available');
    return lines;
  }
  SFM.optionDetail = optionDetail;

})();

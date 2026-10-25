#!/usr/bin/env bash
# scripts/race/approve-race.sh —— 对真实 dev 部署并发发起 mutation，验证“可串行化 + 业务幂等”（part4 §4.2）。
# 前提：
#   - dev 部署设置了 ENABLE_TEST_FUNCTIONS=1；convex/testing.ts 的每个函数开头检查它，否则抛错。
#   - testing:decideAs 是 internalMutation，参数 {proposalId, userId, decision}，内部直接调用 decideCore（跳过 Clerk）。
#   - `npx convex run` 能调用 internal 函数并按位置参数接收 JSON：待验证。
# 每个场景在独立房间里重复 TRIALS 次；输出结果分布与不变量检查。只读源仓库，不改任何文件。
set -euo pipefail
TRIALS="${TRIALS:-30}"
run() { npx convex run "$@" 2>&1; }
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

scenario_last_two_votes() { # C3：Pr 与 F 同时投最后两票
  local seed; seed=$(run testing:seedScopeChange '{"preApprove":["customer"]}')
  local pid uidP uidF room cv
  pid=$(jq -r .v3 <<<"$seed"); uidP=$(jq -r .users.provider <<<"$seed")
  uidF=$(jq -r .users.finance <<<"$seed"); room=$(jq -r .roomId <<<"$seed"); cv=$(jq -r .cv <<<"$seed")
  run testing:decideAs "{\"proposalId\":\"$pid\",\"userId\":\"$uidP\",\"decision\":\"approve\",\"expectedConstraintsVersion\":$cv}" >"$WORK/p.out" &
  run testing:decideAs "{\"proposalId\":\"$pid\",\"userId\":\"$uidF\",\"decision\":\"approve\",\"expectedConstraintsVersion\":$cv}" >"$WORK/f.out" &
  wait
  run testing:checkExecutionInvariants "{\"roomId\":\"$room\"}"     # 期望 []
  run testing:roomCounts "{\"roomId\":\"$room\"}" | jq -c '{executions, changeOrderCommitments, tasks}'  # 期望 1/1/3
}

scenario_same_user_burst() { # C1/C2：同一人 10 个并发 approve 作为最后一票
  local seed; seed=$(run testing:seedScopeChange '{"preApprove":["customer","provider"]}')
  local pid uidF room cv
  pid=$(jq -r .v3 <<<"$seed"); uidF=$(jq -r .users.finance <<<"$seed"); room=$(jq -r .roomId <<<"$seed"); cv=$(jq -r .cv <<<"$seed")
  for _ in $(seq 10); do
    run testing:decideAs "{\"proposalId\":\"$pid\",\"userId\":\"$uidF\",\"decision\":\"approve\",\"expectedConstraintsVersion\":$cv}" >/dev/null &
  done
  wait
  run testing:checkExecutionInvariants "{\"roomId\":\"$room\"}"
  run testing:roomCounts "{\"roomId\":\"$room\"}" | jq -c '{executions, approvalsByFinance}'  # 期望 1/1
}

scenario_budget_vs_vote() { # C5：updateBudget(4800) 与最后一票并发
  local seed; seed=$(run testing:seedScopeChange '{"preApprove":["customer","provider"]}')
  local pid uidF room cv
  pid=$(jq -r .v3 <<<"$seed"); uidF=$(jq -r .users.finance <<<"$seed"); room=$(jq -r .roomId <<<"$seed"); cv=$(jq -r .cv <<<"$seed")
  run testing:updateBudgetAs "{\"roomId\":\"$room\",\"userId\":\"$uidF\",\"newTotalCents\":480000}" >/dev/null &
  run testing:decideAs "{\"proposalId\":\"$pid\",\"userId\":\"$uidF\",\"decision\":\"approve\",\"expectedConstraintsVersion\":$cv}" >/dev/null &
  wait
  run testing:checkExecutionInvariants "{\"roomId\":\"$room\"}"
  # 期望二选一：{executed:1, runAfter:"needs_input"} 或 {executed:0, lastError:"CONSTRAINTS_CHANGED"}
  run testing:roomCounts "{\"roomId\":\"$room\"}" | jq -c '{executions, currentRunStatus, constraintsVersion}'
}

scenario_reject_vs_vote() { # C6
  local seed; seed=$(run testing:seedScopeChange '{"preApprove":["customer","provider"]}')
  local pid uidP uidF room cv
  pid=$(jq -r .v3 <<<"$seed"); uidP=$(jq -r .users.provider <<<"$seed")
  uidF=$(jq -r .users.finance <<<"$seed"); room=$(jq -r .roomId <<<"$seed"); cv=$(jq -r .cv <<<"$seed")
  run testing:decideAs "{\"proposalId\":\"$pid\",\"userId\":\"$uidP\",\"decision\":\"reject\",\"expectedConstraintsVersion\":$cv}" >/dev/null &
  run testing:decideAs "{\"proposalId\":\"$pid\",\"userId\":\"$uidF\",\"decision\":\"approve\",\"expectedConstraintsVersion\":$cv}" >/dev/null &
  wait
  run testing:checkExecutionInvariants "{\"roomId\":\"$room\"}"   # 断言：不存在“已执行且 provider 最新决定为 reject”
}

for s in scenario_last_two_votes scenario_same_user_burst scenario_budget_vs_vote scenario_reject_vs_vote; do
  echo "== $s x $TRIALS"
  for _ in $(seq "$TRIALS"); do "$s"; done | sort | uniq -c
done

import { describe, it } from "vitest";

describe.skipIf(process.env.REAL_DEPLOY !== "1")("RD · 05-idempotent-execution", () => {
  it.todo("CE-096 同一人双击 approve，并发（两事务都读到空区间）");
  it.todo("CE-097 customer 已批；provider 与 finance 并发投最后两票（单进程多 `ConvexHttpClient` + `setAdminAuth`，N=5）");
  it.todo("CE-099 `budget.setCap(5000→4800)` 与最后一票并发");
  it.todo("CE-100 provider reject 与 finance 最后一票并发");
  it.todo("CE-101 customer withdraw 与 finance 最后一票并发（idempotent r10 的 C24）");
  it.todo("CE-102 客户端断线重连重发同一 mutation");
  it.todo("CE-109 `seed.reset` 与执行并发");
  it.todo("CE-119 同一房间并发 `runs.start` ×5");
  it.todo("CE-120 N 个不同身份并发用同一链接邀请领取同一角色席位");

  // W1-1F: issue #52, newly catalogued invariant.
  it.todo("INV-M1 房间写锁（M-ROOM）：每个改变房间业务状态的事务都经 `openRoomTx` 把 `rooms.writeSeq + 1`；房间作用域表只能经 `RoomTx` 写（类型层强制）；同房间并发写入因此在 `rooms` 文档上产生确定的 OCC 冲突，区间读冲突降为第二道防线");
});

import { describe, it as vitestIt } from "vitest";

// W2-3: real convex-test cases; registry titles remain unchanged.
import { cases } from '../w2-3.cases';
const implemented: Record<string, () => Promise<void>> = {
  'INV-77': cases.rollover,
};
const it = { todo(title: string) {
  const body = implemented[title.split(' ')[0]!];
  if (body) vitestIt(title, body);
  else vitestIt.todo(title);
} };
// End W2-3.

describe("CT · 10-time-and-domain", () => {
  it.todo("INV-77 房间时区 `rooms.timeZone` 建房后固定；`rooms.localDate`（`YYYY-MM-DD`）只由 `rooms.create` 与 `clock.rollLocalDate` / `rollLocalDateTx` 写；规则检查与物化在 query 与普通 mutation（含 approve 的纵深防御重算与执行）中一律读 `rooms.localDate`，只有推进日期处用 `todayInTimeZone(Date.now(), room.timeZone)` 计算（`Intl.DateTimeFormat` 时区支持待验证 V-D2）；其余 mutation 读 `Date.now()` 只用于判定过期；query 永不读 `Date.now()`；引擎输入 `today: IsoDate` 由调用方传入（= `rooms.localDate`）");
});

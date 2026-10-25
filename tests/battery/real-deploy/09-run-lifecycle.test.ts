import { describe, it } from "vitest";

describe.skipIf(process.env.REAL_DEPLOY !== "1")("RD · 09-run-lifecycle", () => {
  it.todo("CE-122 finance evaluate 回合进行中 finance 降预算（cv+1）");
  it.todo("CE-124 action 因平台积压延迟 60 s 才开始；看门狗按调度时刻到期");
});

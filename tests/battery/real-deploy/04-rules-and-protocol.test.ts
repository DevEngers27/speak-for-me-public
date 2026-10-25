import { describe, it } from "vitest";

describe.skipIf(process.env.REAL_DEPLOY !== "1")("RD · 04-rules-and-protocol", () => {
  it.todo("CE-086 换模型后 API 对保留 `enum` 的 schema 返回 400");
});

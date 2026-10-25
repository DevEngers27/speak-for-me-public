import { describe, it } from "vitest";

describe.skipIf(process.env.REAL_DEPLOY !== "1")("RD · 01-privacy-delegation", () => {
  it.todo("CE-018 变异：在公开 mutation 内 `console.log(brief)`；dev 部署上以 provider 调用并读 `logLines`");
  it.todo("CE-020 creator 把同一 userId 邀请为 customer 与 finance；两次 `invites.accept` 串行 / 并发");
});

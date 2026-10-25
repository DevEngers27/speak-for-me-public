// Browser rows stay todo until every clause of each title is verified.
import { describe, it } from "vitest";

describe("E2E · 01-privacy-delegation", () => {
  it.todo("INV-14 Next 页面只传 `roomId`；受限数据仅经已鉴权 Convex 订阅加载，查询在 `useConvexAuth().isAuthenticated` 前 `skip`；静态 chunk 与 RSC 负载不含受限 DTO 或密钥");
  it.todo("CE-002 customer 订阅 `rooms.view`；用 `page.on('websocket')` 收全部帧，扫描 `capCents` 的字面与派生写法（`481731`、`4,817.31`、`cap − committed`、`offer − cap`）");
  it.todo("CE-019 三身份打开房间页 view-source 与 RSC 负载，搜索 `*Cents` 与三方金丝雀");
  it.todo("CE-023 打开链接邀请页，检查 token 是否出现在 URL 路径、Referer、Next 日志");
});

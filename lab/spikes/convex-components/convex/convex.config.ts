import { defineApp } from "convex/server";
import workflow from "@convex-dev/workflow/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import actionRetrier from "@convex-dev/action-retrier/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp();
app.use(workflow);
// Separate pool for model calls (global concurrency guard against Anthropic rate limits).
app.use(workpool, { name: "modelPool" });
app.use(actionRetrier);
app.use(rateLimiter);
export default app;

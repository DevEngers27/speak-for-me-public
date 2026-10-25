// @expect-rules no-restricted-imports
import type { GenericQueryCtx } from "convex/server";

export type Leaked = GenericQueryCtx<never>;

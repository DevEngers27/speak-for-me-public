// @expect-rules no-restricted-imports
import { thing } from "~/lib/thing";

export const leaked = thing;

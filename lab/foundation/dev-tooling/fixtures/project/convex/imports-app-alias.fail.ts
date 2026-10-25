// @expect-rules no-restricted-imports
// convex/tsconfig.json does not declare "@/*", so the import does not resolve
// and only the specifier rule can catch it.
import { appConfig } from "@/lib/config";

export const leaked = appConfig;

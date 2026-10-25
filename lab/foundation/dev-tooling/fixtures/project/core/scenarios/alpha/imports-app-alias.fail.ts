// @expect-rules boundaries/dependencies no-restricted-imports
import { appConfig } from "@/lib/config";

export const leaked = appConfig;

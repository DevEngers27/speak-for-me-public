import {
  findCanaries,
  findForbiddenFields,
  type FindOptions,
  type ForbiddenPattern,
} from "./forbiddenFields";

interface MatcherResult {
  pass: boolean;
  message: () => string;
}

/**
 * Vitest matchers. Register once (e.g. in a setup file or at the top of a test
 * file): `expect.extend(convexTestMatchers)`.
 */
export const convexTestMatchers = {
  toHaveNoForbiddenFields(
    received: unknown,
    forbidden: readonly ForbiddenPattern[],
    options?: FindOptions,
  ): MatcherResult {
    const violations = findForbiddenFields(received, forbidden, options);
    return {
      pass: violations.length === 0,
      message: () =>
        violations.length === 0
          ? `expected payload to contain a forbidden field from [${forbidden.map(String).join(", ")}], but it had none`
          : `expected no forbidden fields, found:\n${violations.map((v) => `  ${v.path} (matched ${v.pattern})`).join("\n")}`,
    };
  },
  toContainNoCanaries(received: unknown, canaries: readonly string[]): MatcherResult {
    const hits = findCanaries(received, canaries);
    return {
      pass: hits.length === 0,
      message: () =>
        hits.length === 0
          ? "expected payload to contain a canary, but it had none"
          : `expected no canaries, found:\n${hits.map((h) => `  ${h.path} (${h.where})`).join("\n")}`,
    };
  },
};

declare module "vitest" {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    /** Payload contains no key matching any forbidden pattern (see forbiddenFields.ts). */
    toHaveNoForbiddenFields(forbidden: readonly ForbiddenPattern[], options?: FindOptions): R;
    /** No canary substring appears in any key or string value. */
    toContainNoCanaries(canaries: readonly string[]): R;
  }
}

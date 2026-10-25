import { expect } from "vitest";
import { scopeChangeSimulatedInput } from "./fixtures/scope-change.simulated";
import { safeLoadFixture, type FixtureIssue, type LoadFixtureOptions, type ScenarioFixture } from "./loader";

export type Draft = typeof scopeChangeSimulatedInput;

/** A fresh, mutable deep copy of the example input with `edit` applied. */
export function draftWith(edit: (draft: Draft) => void): Draft {
  const draft = structuredClone(scopeChangeSimulatedInput);
  edit(draft);
  return draft;
}

/** Loads `input`, asserts it fails, and returns the issues. */
export function issuesOf(input: unknown, options?: LoadFixtureOptions): readonly FixtureIssue[] {
  const result = safeLoadFixture(input, options);
  if (result.ok) throw new Error("Expected the fixture to be rejected, but it loaded");
  return result.issues;
}

export function expectIssue(
  issues: readonly FixtureIssue[],
  expected: { path: string; code?: string; check?: string },
): FixtureIssue {
  const match = issues.find(
    (issue) =>
      issue.path === expected.path &&
      (expected.code === undefined || issue.code === expected.code) &&
      (expected.check === undefined || issue.check === expected.check),
  );
  expect(match, `issue ${JSON.stringify(expected)} in ${JSON.stringify(issues, null, 2)}`).toBeDefined();
  return match as FixtureIssue;
}

/** Loads `input` and asserts it succeeds, showing the issues otherwise. */
export function expectLoads(input: unknown, options?: LoadFixtureOptions): ScenarioFixture {
  const result = safeLoadFixture(input, options);
  if (!result.ok) throw new Error(`Expected the fixture to load: ${JSON.stringify(result.issues, null, 2)}`);
  return result.fixture;
}

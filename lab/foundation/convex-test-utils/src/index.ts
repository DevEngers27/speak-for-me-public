export {
  ANONYMOUS,
  DEFAULT_TEST_ISSUER,
  bindRoles,
  defineRoles,
  makeIdentity,
  tokenIdentifierFor,
  withRole,
  type Anonymous,
  type DefineRolesOptions,
  type RoleRegistry,
  type RoleSpec,
  type TestAccessor,
  type WithRole,
} from "./identities";
export {
  defaultCodeOf,
  expectConvexErrorCode,
  isConvexError,
  outcomeOf,
  rejectionOf,
  type CodeExtractor,
  type Outcome,
} from "./errors";
export { roleMatrix, roleOutcomes, type OutcomeLabel, type RoleMatrixOptions } from "./roleMatrix";
export {
  advanceScheduledBy,
  advanceScheduledTo,
  drainScheduled,
  expectNoPendingScheduled,
  listScheduled,
  useFakeTimersForEachTest,
  type DrainOptions,
  type DrainReport,
  type ScheduledJob,
  type ScheduledState,
} from "./scheduler";
export {
  ForbiddenFieldsError,
  assertNoCanaries,
  assertNoForbiddenFields,
  assertPatternsMatch,
  findCanaries,
  findForbiddenFields,
  type CanaryHit,
  type FindOptions,
  type ForbiddenFieldViolation,
  type ForbiddenPattern,
} from "./forbiddenFields";
export { convexTestMatchers } from "./matchers";
export {
  DedupRecipeError,
  verifyQueryThenInsertDedup,
  type DedupRecipe,
  type DedupReport,
} from "./recipes/dedupInsert";
export { countRows, readAll } from "./tables";

export { test, expect, eachRole, type RoleSession, type HarnessOptions, type HarnessWorkerOptions, type HarnessTestFixtures } from "./fixtures.ts";
export { BasePage, type GotoOptions } from "./page-object.ts";
export { ROLE_SLOTS, isRoleSlot, mapRoles, mapRolesAsync, type PerRole, type RoleSlot } from "./roles.ts";
export {
  ENV,
  HarnessConfigError,
  checkClerkCredentials,
  loadHarnessConfig,
  type AuthConfig,
  type AuthMode,
  type ClerkCredentialSource,
  type EnvRecord,
  type HarnessConfig,
  type RoleIdentity,
  type TestSignInStrategy,
} from "./env.ts";
export { createAuthStrategy, createClerkStrategy, noAuthStrategy, type AuthStrategy, type ClerkTestingApi } from "./auth/index.ts";
export { findMarkers, domSample, recordWebSocketFrames, type MarkerHit, type TextSample, type TransportLog } from "./markers.ts";

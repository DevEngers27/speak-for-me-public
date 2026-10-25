export { test, expect, eachRole, storageStateForRole, type RoleSession, type HarnessOptions, type HarnessWorkerOptions, type HarnessTestFixtures } from "./fixtures";
export { BasePage, pathsMatch, type GotoOptions } from "./page-object";
export { ROLE_SLOTS, isRoleSlot, mapRoles, mapRolesAsync, type PerRole, type RoleSlot } from "./roles";
export {
  ENV,
  CLERK_PUBLISHABLE_KEY_NAMES,
  HarnessConfigError,
  checkClerkCredentials,
  ciEnabled,
  loadHarnessConfig,
  parseBootPath,
  type AuthConfig,
  type AuthMode,
  type ClerkCredentialCheck,
  type ClerkCredentialSource,
  type EnvRecord,
  type HarnessConfig,
  type RoleIdentity,
  type TestSignInStrategy,
} from "./env";
export { createAuthStrategy, createClerkStrategy, noAuthStrategy, type AuthStrategy, type ClerkTestingApi } from "./auth/index";
export {
  createTransportLog,
  expectNoMarkers,
  findMarkers,
  pushCapped,
  recordWebSocketFrames,
  scanRoleMarkers,
  domSample,
  type MarkerHit,
  type TextSample,
  type TransportLog,
} from "./markers";
export { projectWantsClerk, selectedBaseUrl } from "./global-setup";

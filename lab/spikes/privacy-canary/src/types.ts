// Shared types for the privacy-canary spike.

export type Role = 'customer' | 'provider' | 'finance';
export const ROOM_ROLES: readonly Role[] = ['customer', 'provider', 'finance'];

/** Pseudo-audience for operator-only sinks (server logs). No secret may reach it. */
export const OPS = '__ops' as const;
export type AudienceMember = Role | typeof OPS;

export type SecretKind = 'string' | 'money' | 'date';

/**
 * One private value that must not reach an unauthorized audience.
 * money values are integer cents; date values are YYYY-MM-DD.
 */
export interface SecretField {
  id: string; // e.g. "finance.capCents.v2"
  ownerRole: Role;
  kind: SecretKind;
  value: string | number;
  /** Roles (besides the owner) allowed to see this value. */
  allowedRoles: readonly Role[];
  /** derived = computed from private values (headroom, over-by); weaker canary. */
  origin: 'brief' | 'constraint' | 'derived';
}

/** Where a surface's content becomes visible. */
export type Audience = readonly AudienceMember[] | 'room' | 'ops';

export type SurfaceKind =
  | 'proposal'
  | 'proposal_public_summary'
  | 'event_rendered'
  | 'commitment'
  | 'task'
  | 'change_order'
  | 'room_view_dto'
  | 'agent_context'
  | 'agent_turn_private'
  | 'log';

export interface Surface {
  id: string;
  kind: SurfaceKind;
  audience: Audience;
  content: unknown; // string or JSON-like value; walked recursively
}

export interface Hit {
  secretId: string;
  surfaceId: string;
  surfaceKind: SurfaceKind;
  path: string; // JSON path inside the surface
  variant: string; // which spelling matched, e.g. "money:grouped"
  matched: string; // matched text (from normalized content)
  decodedVia?: string; // e.g. "base64" when found after decoding
  unauthorizedAudience: AudienceMember[];
}

export interface ScanReport {
  hits: Hit[]; // all matches
  violations: Hit[]; // matches visible to someone not allowed
  scannedSurfaces: number;
  scannedLeaves: number;
}

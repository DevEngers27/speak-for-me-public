import main from './fixtures/generated/main.json';
import canary from './fixtures/generated/canary.json';
import type { Projection, Role } from '../../scripts/gen-ui-fixtures';
export const generated = main as unknown as Record<string, Record<Role, Projection>>;
export const generatedCanary = canary as unknown as typeof generated;
const states = { S3: 'negotiating', S5: 'pending', S7: 'revised', S11: 'executed' } as const;
import privateCanary from './fixtures/generated/canary-private.json';
export const generatedPrivateCanary = privateCanary as unknown as typeof generated;
export function buildRoomView(role: Role, phase: keyof typeof states) { return structuredClone(generated[states[phase]]![role].room); }
export function buildExecution(role: Role, phase: keyof typeof states) { return structuredClone(generated[states[phase]]![role].execution); }
export function buildCanaryRoomView(role: Role, phase: keyof typeof states, options?: { zeroDisclosures?: boolean }) { return structuredClone((options?.zeroDisclosures ? generatedPrivateCanary : generatedCanary)[states[phase]]![role].room); }

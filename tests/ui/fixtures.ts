import { generated, generatedCanary, generatedPrivateCanary } from './generated-fixtures';
import type { Role, RoomView, InboxCard, PreviewChangeView } from '@/lib/viewModels/types';
import type { ScopeChangeFixture } from '@core/scenarios/scope-change/fixtures';
export { CANARY_CUSTOMER, CANARY_FINANCE, CANARY_PROVIDER, canaryAmounts } from '@core/scenarios/scope-change/fixtures';
export type WalkthroughPhase = 'S3' | 'S5' | 'S7' | 'S11';
export interface BuildFixtureOptions { fixture?: ScopeChangeFixture; constraintActor?: 'finance' | 'customer'; zeroDisclosures?: boolean }
const states = { S3: 'negotiating', S5: 'pending', S7: 'revised', S11: 'executed' };
function projection(role: Role, phase: WalkthroughPhase, options?: BuildFixtureOptions) {
 const source = options?.zeroDisclosures ? generatedPrivateCanary : options?.fixture?.key === 'canary' ? generatedCanary : generated;
 return structuredClone(source[states[phase]!]![role]);
}
export const TEST_ROOM_ID = generated.pending!.customer.room.header.roomId;
export function buildRoomView(role: Role, phase: WalkthroughPhase, options?: BuildFixtureOptions): RoomView {
 const room = projection(role, phase, options).room;
 return room;
}
export function buildCanaryRoomView(role: Role, phase: WalkthroughPhase, options?: {zeroDisclosures?: boolean}) {
 return buildRoomView(role, phase, { ...options, fixture: {key:'canary'} as ScopeChangeFixture });
}
export function buildBudget(role: Role, phase: WalkthroughPhase, options?: BuildFixtureOptions) { return buildRoomView(role,phase,options).budget; }
export function buildTimeline(role: Role, phase: WalkthroughPhase, options?: BuildFixtureOptions) { return projection(role,phase,options).timeline.page; }
export function buildExecution(role: Role, phase: WalkthroughPhase, options?: BuildFixtureOptions) { return projection(role,phase,options).execution; }
export function buildBriefQuery(role: Role, phase: WalkthroughPhase, options?: BuildFixtureOptions) { return projection(role,phase,options).brief!; }
export function buildCatalogQuery(options?: BuildFixtureOptions) { return projection('provider','S5',options).catalog!; }
export function buildInboxCard(role: Role, phase: WalkthroughPhase): InboxCard {
 return projection(role,phase).inbox.page[0]!;
}
// Synthetic preview dialog edge: no mutation is performed by this fixture.
export function buildPreviewChange(role: Role): PreviewChangeView {
 const common = { nextConstraintsVersion: 2, invalidatedApprovals: 2, willSupersedeRun: false };
 return role === 'finance' ? {verdict:'after', ...common, verdictAfter:{proposalVersion:1,budgetCheck:'budget.over',overByCents:10000}} : {verdict:'recheck',...common};
}

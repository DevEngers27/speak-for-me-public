import { createPublicTextRenderer, definePublicTemplates, slot } from './publicText';

const text = {
 change_order_disclaimer: 'Internal record only. No payment, transfer, contract signature, or ERP update happens here.',
 setup: 'Finish setting up the room', negotiating: 'Agents are working', needs_input: 'A human decision is needed', awaiting_approval: 'Review the current proposal', stopped: 'Negotiation stopped', executed: 'Agreement executed', closed: 'Room closed',
 decide_proposal: 'Review and decide on the proposal', answer_request: 'Choose how to proceed', confirm_brief: 'Confirm your brief', confirm_catalog: 'Confirm the catalog', record_baseline: 'Record the baseline', invite: 'Invite the remaining participants', invite_member: 'Invite the remaining participants', task: 'Complete your assigned task', redecide_proposal: 'Review and decide on the proposal again', complete_task: 'Complete your assigned task',
} as const;
const templates = createPublicTextRenderer(definePublicTemplates(Object.fromEntries(Object.entries(text).map(([key, value]) => [key, { reads: [], slots: {}, variants: { room: value, buyer: value, owner: value } }]))));
export function uiStatusText(key: string): string {
 return Object.hasOwn(text, key) ? templates.renderPublicText(key, {}) : 'Review your room';
}
const waiting = createPublicTextRenderer(definePublicTemplates({ waiting: { reads: ['role', 'domain'], slots: { role: slot.enum({ Customer: 'Customer', Provider: 'Provider', Finance: 'Finance' } as const), domain: slot.enum({ 'the budget': 'the budget', 'their agent': 'their agent', 'the scope or deadline': 'the scope or deadline', 'the catalog': 'the catalog', 'the next round': 'the next round', 'a clarification': 'a clarification', 'the next step': 'the next step' } as const) }, variants: { room: 'Waiting on others', buyer: 'Waiting on {role} to answer about {domain}.', owner: 'Your decision is needed' } } }));
export function waitingText(kind: string, role: 'customer' | 'provider' | 'finance'): string {
 const domain = kind === 'infeasible' ? role === 'finance' ? 'the budget' : role === 'customer' ? 'the scope or deadline' : 'the catalog' : kind === 'agent_failed' || kind === 'agent_escalated' ? 'their agent' : kind === 'rounds_exhausted' ? 'the next round' : kind === 'clarify' ? 'a clarification' : 'the next step';
 return waiting.renderPublicText('waiting', { role: role === 'customer' ? 'Customer' : role === 'provider' ? 'Provider' : 'Finance', domain }, 'buyer');
}

const requestCopy = createPublicTextRenderer(definePublicTemplates({
 pass: {reads:['role'],slots:{role:slot.enum({customer:'Customer',provider:'Provider',finance:'Finance'})},variants:{room:'Pass to {role}',buyer:'Pass to {role}',owner:'Pass to {role}'}},
 consent: {reads:['roles','field'],slots:{roles:slot.list(slot.enum({customer:'Customer',provider:'Provider',finance:'Finance'}),{separator:' and ',minItems:1,maxItems:3}),field:slot.enum({deadline:'deadline',requiredItemKeys:'requiredItemKeys',preferredItemKeys:'preferredItemKeys',capCents:'capCents',committedCents:'committedCents',headroomCents:'headroomCents'})},variants:{room:'{roles} and their agent will see: {field}',buyer:'{roles} and their agent will see: {field}',owner:'{roles} and their agent will see: {field}'}},
}));
export function passRequestText(role: "customer" | "provider" | "finance"): string { return requestCopy.renderPublicText('pass',{role},'owner'); }
export function disclosureConsentText(roles: readonly ("customer" | "provider" | "finance")[], field: string): string { return requestCopy.renderPublicText('consent',{roles,field: field as 'deadline' | 'requiredItemKeys' | 'preferredItemKeys' | 'capCents' | 'committedCents' | 'headroomCents'},'owner'); }

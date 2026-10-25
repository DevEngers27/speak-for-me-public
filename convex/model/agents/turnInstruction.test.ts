import { expect, it } from 'vitest';
import { allowedActions, enumerateCandidates } from '../../../core/engine';
import { encodeBlock, sanitizeUntrustedText, wrapCatalogTitles } from '../../../core/engine/projection';
import { turnInstruction, type TurnInstructionInput } from '../../../core/engine/protocol/turnInstruction';
import { main, scopeChangePlugin, viewForRoleFromFixture } from '../../../core/scenarios/scope-change';
import { assertWhitelisted, buildRequest } from './modelGateway';

const schema = { type: 'object' as const, additionalProperties: false, required: ['turn'], properties: {
  turn: { type: 'object', additionalProperties: false, required: ['action', 'optionKey', 'rationale'], properties: {
    action: { type: 'string', enum: ['propose'] }, optionKey: { type: 'string' }, rationale: { type: 'string' },
  } },
} };
const instruction = turnInstruction({ turnKind: 'propose', allowedActions: ['propose', 'clarify', 'escalate'] });
const messages = [{ role: 'user' as const, content: '<room_state>{}</room_state>' }, { role: 'system' as const, content: instruction }];

it('AUD-FOUNDATION-03: accepts the design body and text-only instruction blocks', () => {
  const body = buildRequest({ system: 'Role charter.', messages, schema });
  expect(() => assertWhitelisted(body)).not.toThrow();
  expect(() => assertWhitelisted({ ...body, messages: [messages[0], { role: 'system', content: [{ type: 'text', text: instruction }] }] })).not.toThrow();
  for (const invalid of [
    [messages[1], messages[0]], [messages[0]], [],
    [messages[0], messages[0]], [...messages, messages[0]],
    [messages[0], { role: 'assistant', content: 'history' }, messages[1]],
    [{ role: 'assistant', content: 'history' }, messages[1]],
    [messages[0], { role: 'system', content: [{ type: 'thinking', thinking: 'hidden' }] }],
    [messages[0], { role: 'system', content: [{ type: 'text', text: instruction, extra: true }] }],
    [messages[0], { role: 'system', content: [] }],
  ]) expect(() => assertWhitelisted({ ...body, messages: invalid })).toThrow();
});

it('main fixture provider propose: snapshots the exact gateway request body', () => {
  const view = viewForRoleFromFixture(main, 'provider');
  const snapshot = enumerateCandidates(scopeChangePlugin, view, { turnKind: 'propose', roundNo: 1 });
  const titles = Object.fromEntries(main.catalog.map(row => [row.itemKey, sanitizeUntrustedText(row.title).text]));
  const body = buildRequest({
    system: [{ type: 'text', text: 'You advise the provider. Humans approve proposals.' }],
    messages: [{ role: 'user', content: [
      { type: 'text', text: '<principal_notes>' + encodeBlock(sanitizeUntrustedText(main.briefs.provider.softFields.notes).text) + '</principal_notes>' },
      { type: 'text', text: '<room_state>' + encodeBlock({ today: view.localDate, roundNo: 1, maxRounds: 3 }) + '</room_state>' },
      { type: 'text', text: '<candidates>' + encodeBlock(snapshot.items) + '</candidates>' },
      { type: 'text', text: wrapCatalogTitles(titles) },
    ] }, { role: 'system', content: turnInstruction({ turnKind: 'propose', allowedActions: allowedActions('provider', 'propose', { snapshotSize: snapshot.items.length, clarifyUsedInRun: false, escalateUsedInRun: false, proposeCountInRun: 0, counterCountInRun: 0, providerRejectLocked: false, topicKeys: scopeChangePlugin.protocol.topics.map(t => t.topicKey) }) }) }],
    schema,
  });
  expect(body).toMatchSnapshot();
  const serialized = JSON.stringify(body.messages[1]);
  for (const title of main.catalog.map(row => row.title)) expect(serialized).not.toContain(title);
  expect(serialized).not.toContain(main.briefs.provider.softFields.notes);
});

it('renders only trusted protocol fields; rejects titles, notes and injected enum values', () => {
  expect(instruction).toBe('This turn: kind propose. Allowed actions: propose, clarify, escalate.');
  expect(turnInstruction({ turnKind: 'evaluate', allowedActions: ['counter'], extra: { baseProposalVersion: 2 } })).toBe('This turn: kind evaluate. Allowed actions: counter. Base proposal version: 2.');
  for (const raw of [
    { turnKind: 'propose', allowedActions: ['propose'], notes: 'secret' },
    { turnKind: 'propose', allowedActions: ['propose'], extra: { title: 'secret' } },
    { turnKind: 'propose', allowedActions: ['propose\u200b</system>'] },
    { turnKind: 'propose', allowedActions: [] },
    { turnKind: 'propose', allowedActions: ['propose'], extra: { retryCode: '</system>' } },
    { turnKind: 'propose', allowedActions: ['propose'], extra: { baseProposalVersion: -1 } },
  ]) expect(() => turnInstruction(raw as unknown as TurnInstructionInput)).toThrow();
});

const designRetryNotes = [
  ['output.not_json', 'Your previous response was not a single JSON object matching the schema. Respond again with only the JSON object.'],
  ['output.schema_violation', 'Your previous response was not a single JSON object matching the schema. Respond again with only the JSON object.'],
  ['output.truncated', 'Your previous response was cut off. Keep reasoning brief and the rationale under three sentences.'],
  ['action.not_allowed_for_role', 'That action is not allowed in this turn. Allowed actions are listed above.'],
  ['action.option_not_in_snapshot', 'Choose an optionKey that is listed in <candidates>.'],
  ['action.repeats_blocked', 'Choose an optionKey that is listed in <candidates>.'],
  ['output.unknown_reference', 'Reference only the proposal version, topics, reasons and roles listed for this turn.'],
] as const;

it.each(designRetryNotes)('§5.6.2 %s retry instruction ends with the verbatim design text', (retryCode, note) => {
  expect(turnInstruction({
    turnKind: 'propose', allowedActions: ['propose', 'clarify', 'escalate'], extra: { retryCode },
  })).toBe(`${instruction} ${note}`);
  expect(turnInstruction({
    turnKind: 'evaluate', allowedActions: ['counter'], extra: { baseProposalVersion: 2, retryCode },
  })).toBe(`This turn: kind evaluate. Allowed actions: counter. Base proposal version: 2. ${note}`);
});

it('rejects an unknown retry code instead of rendering arbitrary text', () => {
  expect(() => turnInstruction({
    turnKind: 'propose', allowedActions: ['propose'], extra: { retryCode: 'unknown.code' },
  } as unknown as TurnInstructionInput)).toThrow('Invalid turn instruction metadata');
});

// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {script,scriptedSuccess} from '../convex-helpers/scriptedModel';
import { generateUiFixtures } from '../../scripts/gen-ui-fixtures';

it.each([{ canary: false, zero: false }, { canary: true, zero: false }, { canary: true, zero: true }])('13.16 real public-query snapshots do not drift ($canary, $zero)', async ({ canary, zero }) => {
 const fresh = await generateUiFixtures(canary, zero);
 const directory = 'tests/ui/fixtures/generated';
 mkdirSync(directory, { recursive: true });
 const file = `${directory}/${zero ? 'canary-private' : canary ? 'canary' : 'main'}.json`;
 if (process.env.UPDATE_UI_FIXTURES === '1') writeFileSync(file, JSON.stringify(fresh, null, 2) + '\n');
 expect(fresh).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}, 60000);

it('TC-PRIV-21 generated provider bytes do not identify the private bump author', async () => {
 const { generatePrivacyFixtures } = await import('../../scripts/gen-ui-fixtures');
 const fresh = await generatePrivacyFixtures();
 const file = 'tests/ui/fixtures/generated/private-bumps.json';
 if (process.env.UPDATE_UI_FIXTURES === '1') writeFileSync(file, JSON.stringify(fresh, null, 2) + '\n');
 expect(fresh).toEqual(JSON.parse(readFileSync(file, 'utf8')));
 expect(JSON.stringify(fresh.finance)).toBe(JSON.stringify(fresh.customer));
});

it('I-FE-4 generated DTOs and rendered provider screens exclude private cents and notes', async () => {
 const { generatedCanary } = await import('./generated-fixtures');
 const { renderToStaticMarkup } = await import('react-dom/server');
 const { RoomWorkbench } = await import('@/components/room/RoomWorkbench');
 const { ResultsScreen } = await import('@/components/room/RoomSections');
 for (const projections of Object.values(generatedCanary)) {
  const p = projections.provider;
  const payload = JSON.stringify(p) + renderToStaticMarkup(<><RoomWorkbench view={p.room} timeline={p.timeline.page} /><ResultsScreen view={p.room} execution={p.execution} /></>);
  for (const marker of ['CANARY-CUS-2219', 'CANARY-FIN-7731', '512347', '481237', '400219', '112128', '81018', '490219', '8982', '480219', '1018', '$5,123.47', '$4,812.37', '$4,002.19', '$1,121.28', '$810.18', '$4,902.19', '$89.82', '$4,802.19', '$10.18']) expect(payload, marker).not.toContain(marker);
  expect(p.room.budget).toEqual({ visibility: 'none' });
 }
});

it('I-FE-2 generated approval slots and completesSet follow the real public decision sequence', async () => {
 const { generated } = await import('./generated-fixtures');
 expect(Object.keys(generated)).toHaveLength(15);
 expect(generated.pending!.customer.room.currentProposal!.approvals.every(slot => slot.state === 'pending')).toBe(true);
 expect(generated['one-approved']!.customer.room.currentProposal!.approvals.find(slot => slot.role === 'customer')!.state).toBe('approved');
 expect(generated.withdrawn!.customer.room.currentProposal!.approvals.find(slot => slot.role === 'customer')!.state).toBe('withdrawn');
 expect(generated['last-vote']!.finance.room.currentProposal!.myAction.completesSet).toBe(true);
 expect(generated.pending!.finance.room.currentProposal!.myAction.completesSet).toBe(false);
 expect(generated.executed!.finance.execution!.changeOrder.amountChain?.committedAfterCents).toBe(480000);
});

it('I-FE-7 generated run projection renders attempt details only for the turn owner', async () => {
 const { generated } = await import('./generated-fixtures');
 const { renderToStaticMarkup } = await import('react-dom/server');
 const { RoomWorkbench } = await import('@/components/room/RoomWorkbench');
 for (const role of ['customer', 'provider', 'finance'] as const) {
  const room = generated.negotiating![role].room;
  const markup = renderToStaticMarkup(<RoomWorkbench view={room} />);
  if (role === room.run!.activeRole) expect(room.run!.attemptStatus).toBe('running');
  else { expect(room.run!.attemptStatus).toBeNull(); expect(room.run!.waiting).toBeNull(); expect(markup).not.toContain('attempt-status'); }
 }
});

it('I-FE-5 generated provider waiting screens never identify the request recipient', async () => {
 const { generated } = await import('./generated-fixtures');
 const { renderToStaticMarkup } = await import('react-dom/server');
 const { RequestScreen } = await import('@/components/room/RoomSections');
 const room = generated.revised!.provider.room;
 expect(room.openRequest).toEqual({ mine: false, kind: 'run_waiting' });
 const markup = renderToStaticMarkup(<RequestScreen view={room} />);
 expect(markup).toContain('Waiting on others');
 expect(markup).not.toMatch(/Waiting on Finance|Waiting on Customer|rounds_exhausted/);
});

it('I-FE-3 generated public queries return projected objects without storage metadata', async () => {
 const { generated, generatedCanary } = await import('./generated-fixtures');
 for (const fixture of [generated, generatedCanary]) {
  expect(JSON.stringify(fixture)).not.toMatch(/"_creationTime"|"_id"|"actorUserId"|"restrictedRef"|"payload"/);
 }
});

it('I-FE-9 generated workbenches expose Close room only to the creator', async () => {
 const { generated } = await import('./generated-fixtures');
 const { renderToStaticMarkup } = await import('react-dom/server');
 const { RoomWorkbench } = await import('@/components/room/RoomWorkbench');
 for (const role of ['customer', 'provider', 'finance'] as const) {
  const room = generated.negotiating![role].room;
  expect(renderToStaticMarkup(<RoomWorkbench view={room} />).includes('Close room')).toBe(room.header.isCreator);
 }
 const screens = readFileSync('src/components/room/RoomScreens.tsx', 'utf8');
 expect(screens).toContain('useMutation(api.rooms.close)');
});

it('I-FE-1 server room layout passes only the route id to its client frame', () => {
 const layout = readFileSync('src/app/(app)/rooms/[roomId]/layout.tsx', 'utf8');
 expect(layout).not.toMatch(/fetchQuery|preloadQuery|ConvexHttpClient|api\.rooms/);
 expect(layout).toContain('<RoomFrame roomId={roomId}>');
});

it('W1-6-r06 stopped and closed states come from public cancel and close mutations', async () => {
 const { generateTerminalUiFixtures } = await import('../../scripts/gen-ui-fixtures');
 const fresh = await generateTerminalUiFixtures();
 const file = 'tests/ui/fixtures/generated/terminal.json';
 if (process.env.UPDATE_UI_FIXTURES === '1') writeFileSync(file, JSON.stringify(fresh, null, 2) + '\n');
 expect(fresh).toEqual(JSON.parse(readFileSync(file, 'utf8')));
 for (const state of ['stopped', 'closed']) for (const projection of Object.values(fresh[state]!)) expect(projection).toMatchObject({ room: { header: { phase: { phase: state } } } });
});

// @vitest-environment node
it('n7 zero-disclosure options expose only customer-view values', async () => {
 const fresh = await generateUiFixtures(true, true, true);
 const file = 'tests/ui/fixtures/generated/blocked-request.json';
 if (process.env.UPDATE_UI_FIXTURES === '1') writeFileSync(file, JSON.stringify(fresh, null, 2) + '\n');
 expect(fresh).toEqual(JSON.parse(readFileSync(file, 'utf8')));
 const projection = fresh['initial-request']!.customer;
 const request = projection.room.openRequest;
 if (!request?.mine) throw new Error('Expected own request');
 expect(request.kind).toBe('rounds_exhausted');
 expect(projection.room.budget).toEqual({visibility:'customer', capCents:null, committedCents:null, headroomCents:null});
 expect(request.options.map(o => o.text)).toEqual(['Choose this option', 'Choose this option', 'Keep the current constraints', 'End this run']);
 expect(request.options.map(o => o.effectView)).toEqual([
  {amountCents:80000, deliveryDate:'2026-11-18', itemKeys:['audit_log_export','sso_login'], modifiers:[]},
  {amountCents:90000, deliveryDate:'2026-11-20', itemKeys:['audit_log_export','sso_login','usage_dashboard'], modifiers:[]}, {}, {}]);
 const { renderToStaticMarkup } = await import('react-dom/server');
 const { RequestScreen } = await import('@/components/room/RoomSections');
 const payload = JSON.stringify(projection.request) + renderToStaticMarkup(<RequestScreen view={projection.room} requestDetail={projection.request} />);
 expect(payload).not.toMatch(/capCents|committedCents|headroomCents|512347|481237|400219|112128/);
 for (const option of request.options) expect(option.answerable).toBe(true);
});

it('closed request snapshot preserves status, reason, and closing constraints version', async () => {
 const fresh = await generateUiFixtures(false, false, false, true);
 const file = 'tests/ui/fixtures/generated/closed-request.json';
 if (process.env.UPDATE_UI_FIXTURES === '1') writeFileSync(file, JSON.stringify(fresh, null, 2) + '\n');
 expect(fresh).toEqual(JSON.parse(readFileSync(file, 'utf8')));
 const projection = fresh['request-closed']!.customer;
 expect(projection.request).toMatchObject({status: 'superseded', closedReason: 'constraints_changed', closedAtConstraintsVersion: 3});
 const { renderToStaticMarkup } = await import('react-dom/server');
 const { RequestScreen } = await import('@/components/room/RoomSections');
 const html = renderToStaticMarkup(<RequestScreen view={projection.room} requestDetail={projection.request} />);
 expect(html).toContain('Status: superseded');
 expect(html).toContain('constraints_changed');
 expect(html).toContain('Constraints v3');
 expect(html).not.toContain('confirm-request-answer');
});

it('infeasible request snapshots use the real finance cap options', async () => {
 const fresh = await generateUiFixtures(false, false, false, false, true);
 const file = 'tests/ui/fixtures/generated/infeasible-request.json';
 if (process.env.UPDATE_UI_FIXTURES === '1') writeFileSync(file, JSON.stringify(fresh, null, 2) + '\n');
 expect(fresh).toEqual(JSON.parse(readFileSync(file, 'utf8')));
 expect(fresh.revised!.finance.request).toMatchObject({mine:true,kind:'infeasible'});
});

it('both request queries expose canonical option type and shown', async () => {
 const {generatedPrivateCanary} = await import('./generated-fixtures');
 const projection = generatedPrivateCanary['initial-request']!.customer;
 for (const request of [projection.room.openRequest, projection.request]) {
  if (!request?.mine) throw new Error('Expected own request');
  for (const option of request.options) expect(option).toMatchObject({type:expect.any(String),shown:expect.any(Object)});
 }
});

it('proposal fields and agent commentary follow the displayed version in every generated phase', async () => {
 const { generated } = await import('./generated-fixtures');
 const { renderToStaticMarkup } = await import('react-dom/server');
 const { DecisionScreen } = await import('@/components/room/RoomSections');
 const { RoomWorkbench } = await import('@/components/room/RoomWorkbench');
 for (const projections of Object.values(generated)) for (const role of ['customer','provider','finance'] as const) {
  const room = projections[role].room;
  const card = room.currentProposal;
  if (!card) continue;
  expect(card).toHaveProperty('fit');
  if (role === 'customer') expect(Array.isArray(card.notIncludedForMe)).toBe(true);
  if (card.myAgentSuggestion) expect(card.myAgentSuggestion.proposalVersion).toBe(card.version);
  for (const element of [<DecisionScreen key="decision" view={room} version={card.version} />, <RoomWorkbench key="workbench" view={room} />]) {
   const html = renderToStaticMarkup(element);
   expect(html.includes('data-testid="agent-box"')).toBe(card.myAgentSuggestion?.proposalVersion === card.version);
   if (!card.myAgentSuggestion) expect(html).toContain('commented on this version');
  }
  if (card.myAgentSuggestion) {
   // Synthetic stale subscription over a real projection exercises the UI guard.
   const outdated = structuredClone(room);
   outdated.currentProposal!.myAgentSuggestion!.proposalVersion = card.version + 1;
   for (const element of [<DecisionScreen key="decision" view={outdated} version={card.version} />, <RoomWorkbench key="workbench" view={outdated} />]) {
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain('data-testid="agent-box"');
    expect(html).toContain('commented on this version');
   }
  }
 }
});

it('round 7 public infeasible request option fixtures regenerate identically', async () => {
 const {generateOptionFixtures}=await import('../../scripts/gen-ui-fixtures');
 const fresh=await generateOptionFixtures();
 const file='tests/ui/fixtures/generated/option-payloads.json';
 if(process.env.UPDATE_UI_FIXTURES==='1')writeFileSync(file,JSON.stringify(fresh,null,2)+'\n');
 expect(fresh).toEqual(JSON.parse(readFileSync(file,'utf8')));
 const fixtures=fresh as unknown as Record<string, Record<string, {request:{mine:boolean;kind:string;options:{type:string}[]}}>>;
 for(const [scenario,role,kind] of [['customer','customer','drop_items'],['finance','finance','raise_cap'],['fallback','customer','disclose']] as const){
  const request=fixtures[scenario]![role]!.request;
  expect(request).toMatchObject({mine:true,kind:'infeasible'});
  expect(request.options.some(o=>o.type===kind)).toBe(true);
 }
});

it('round 7 clarify disclosure snapshots regenerate identically from a Provider turn',async()=>{
 script.enqueue(scriptedSuccess({action:'clarify',toRole:'customer',topicKey:'deadline_value',rationale:'Please clarify.'}));
 const {generateClarifyFixture}=await import('../../scripts/gen-ui-fixtures');
 const fresh=await generateClarifyFixture();
 const file='tests/ui/fixtures/generated/clarify-payload.json';
 if(process.env.UPDATE_UI_FIXTURES==='1')writeFileSync(file,JSON.stringify(fresh,null,2)+'\n');
 expect(fresh).toEqual(JSON.parse(readFileSync(file,'utf8')));
});

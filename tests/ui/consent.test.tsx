import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RequestScreen } from '@/components/room/RoomSections';
import { api } from '@/lib/api';
import { seedRoom } from '../convex-helpers/seedRoom.fixture';
import { script, scriptedSuccess } from '../convex-helpers/scriptedModel';
import { drainDue } from '../convex-helpers/scheduler';
import { buildRoomView } from './fixtures';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });
it('clarify-origin Provider request for Customer deadline confirms the public payload and own value', async () => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
 vi.stubEnv('AGENT_MODE', 'live'); vi.stubEnv('DEPLOYMENT_TIER', 'dev'); vi.stubEnv('ANTHROPIC_API_KEY', 'scripted-key');
 script.enqueue(scriptedSuccess({action:'clarify', toRole:'customer', topicKey:'deadline_value', rationale:'Please clarify.'}));
 const s = await seedRoom({agentMode:'live'}); await drainDue(s.t);
 const view = (await s.as('customer').query(api.rooms.view,{roomId:s.roomId}))!;
 const brief = await s.as('customer').query(api.briefs.mine,{roomId:s.roomId});
 if (!view.openRequest?.mine) throw new Error('Expected own clarify request');
 const option = view.openRequest.options.find(o=>o.type==='disclose')!;
 expect(option).toMatchObject({disclose:{field:'deadline',toRoles:['provider']}});
 const answer=vi.fn(); render(<RequestScreen view={view} brief={brief} onAnswerRequest={answer}/>);
 fireEvent.click(screen.getByTestId(`request-radio-${option.optionKey}`)); fireEvent.click(screen.getByTestId('confirm-request-answer'));
 expect(screen.getByRole('alertdialog').textContent).toBe('Provider and their agent will see: Delivery deadline Nov 24, 2026');
 expect(answer).not.toHaveBeenCalled(); fireEvent.click(screen.getByTestId('confirm-request-answer')); expect(answer).toHaveBeenCalledWith(option.optionKey);
 cleanup();
 for (const role of ['provider','finance'] as const) {
  const room=(await s.as(role).query(api.rooms.view,{roomId:s.roomId}))!;
  const request=await s.as(role).query(api.humanRequests.get,{requestId:view.openRequest.requestId});
  expect(JSON.stringify(request)).not.toMatch(/disclose|toRoles|deadline/);
  render(<RequestScreen view={room} requestDetail={request}/>);
  expect(screen.queryByTestId('request-options-group')).toBeNull(); cleanup();
 }
});
it('choose_candidate confirms proposal creation before answering', async () => {
 const view=buildRoomView('customer','S7');
 if (!view.openRequest?.mine) throw new Error('Expected own request');
 const option=view.openRequest.options.find(o=>o.type==='choose_candidate')!;
 const answer=vi.fn();
 render(<RequestScreen view={view} onAnswerRequest={answer}/>);
 fireEvent.click(screen.getByTestId(`request-radio-${option.optionKey}`));
 fireEvent.click(screen.getByTestId('confirm-request-answer'));
 expect(screen.getByRole('alertdialog').textContent).toContain('This creates a proposal. You will still need to approve it.');
 expect(answer).not.toHaveBeenCalled();
 fireEvent.click(screen.getByTestId('confirm-request-answer'));
 expect(answer).toHaveBeenCalledWith(option.optionKey);
});
it('typed disclose confirms the server audience and own briefs.mine value before answering', async () => {
 const s=await seedRoom();
 const brief=await s.as('customer').query(api.briefs.mine,{roomId:s.roomId});
 const view=buildRoomView('customer','S7');
 if (!view.openRequest?.mine) throw new Error('Expected own request');
 const option={...view.openRequest.options[0]!, type:'disclose' as const, text:'Server disclosure choice', disclose:{field:'deadline',toRoles:['provider' as const]}};
 const futureView={...view,openRequest:{...view.openRequest,options:[option]}};
 const answer=vi.fn();
 render(<RequestScreen view={futureView} brief={brief} onAnswerRequest={answer}/>);
 fireEvent.click(screen.getByTestId(`request-radio-${option.optionKey}`));
 fireEvent.click(screen.getByTestId('confirm-request-answer'));
 expect(screen.getByRole('alertdialog').textContent).toContain('Provider and their agent will see: Delivery deadline');
 expect(screen.getByRole('alertdialog').textContent).toContain('Nov 24, 2026');
 expect(answer).not.toHaveBeenCalled();
 fireEvent.click(screen.getByTestId('confirm-request-answer'));
 expect(answer).toHaveBeenCalledWith(option.optionKey);
});
it('disclosure remains disabled when briefs.mine lacks the requested field', async () => {
 const s=await seedRoom();
 const brief=await s.as('customer').query(api.briefs.mine,{roomId:s.roomId});
 const view=buildRoomView('customer','S7');
 if (!view.openRequest?.mine) throw new Error('Expected own request');
 const option={...view.openRequest.options[0]!,type:'disclose' as const,disclose:{field:'missingField',toRoles:['provider' as const]}};
 const answer=vi.fn();
 render(<RequestScreen view={{...view,openRequest:{...view.openRequest,options:[option]}}} brief={brief} onAnswerRequest={answer}/>);
 const radio=screen.getByTestId(`request-radio-${option.optionKey}`) as HTMLInputElement;
 expect(radio.disabled).toBe(true);
 fireEvent.click(radio);
 fireEvent.click(screen.getByTestId('confirm-request-answer'));
 expect(answer).not.toHaveBeenCalled();
});

it('round 7 generated target options confirm and non-targets render no option payload', async()=>{
 const {default: raw}=await import('./fixtures/generated/option-payloads.json');
 const {default: clarify}=await import('./fixtures/generated/clarify-payload.json');
 type P={room:import('@/lib/viewModels/types').RoomView;brief:import('@/lib/viewModels/types').MyBriefView;request:import('convex/server').FunctionReturnType<typeof api.humanRequests.get>};
 const fixtures={...raw,clarify} as unknown as Record<string,Record<string,P>>;
 const seen=new Set<string>();
 for(const projections of Object.values(fixtures))for(const p of Object.values(projections)){
  const request=p.request;
  if(!request?.mine){
   expect(request).not.toHaveProperty('options');
   expect(p.room.openRequest).not.toHaveProperty('options');
   render(<RequestScreen view={p.room} requestDetail={request} brief={p.brief}/>);
   expect(screen.queryByTestId('request-options-group')).toBeNull();cleanup();continue;
  }
  for(const option of request.options){
   seen.add(option.type);
   if(option.type!=='disclose'&&option.type!=='pass_to_next')continue;
   const answer=vi.fn();render(<RequestScreen view={p.room} requestDetail={request} brief={p.brief} onAnswerRequest={answer}/>);
   const radio=screen.getByTestId(`request-radio-${option.optionKey}`) as HTMLInputElement;
   expect(radio.disabled).toBe(false);
   fireEvent.click(radio);fireEvent.click(screen.getByTestId('confirm-request-answer'));
   expect(answer).not.toHaveBeenCalled();
   const copy=screen.getByRole('alertdialog').textContent;
   if(option.type==='disclose'){
    const {ownDisclosureValue}=await import('@/components/room/requestConsent');
    const {formatRole,formatSharedValue,formatFieldLabel}=await import('@/lib/format');
    expect(copy).toBe(`${option.disclose.toRoles.map(formatRole).join(' and ')} and their agent will see: ${formatFieldLabel(option.disclose.field)} ${formatSharedValue(ownDisclosureValue(option,p.brief),p.room.catalog)}`);
   }else expect(copy).toBe('Pass to Finance');
   fireEvent.click(screen.getByTestId('confirm-request-answer'));expect(answer).toHaveBeenCalledWith(option.optionKey);cleanup();
  }
 }
 expect([...seen]).toEqual(expect.arrayContaining(['disclose','drop_items','extend_deadline','raise_cap','pass_to_next']));
});

it('13.10 C sharing control displays the own brief value before consent',async()=>{
 const {BriefScreen}=await import('@/components/room/RoomSections');
 const {generated}=await import('./generated-fixtures');
 for(const role of ['customer','finance'] as const){
  const p=generated.pending![role];
  render(<BriefScreen view={p.room} brief={p.brief}/>);
  const gate=screen.getByTestId('disclosure-gate-box');
  expect((screen.getByTestId('confirm-own-disclosure-checkbox') as HTMLInputElement).checked).toBe(false);
  expect(gate.textContent).toContain(role==='finance'?'Customer and their agent will see: Budget cap $5,000.00':'Provider and Finance and their agent will see: Delivery deadline Nov 22, 2026');
  cleanup();
 }
});

it('W2-6R7-r01 whole provider projections contain no buyer payload, private amounts, deadline or notes',async()=>{
 const {default: options}=await import('./fixtures/generated/option-payloads.json');
 const {default: clarify}=await import('./fixtures/generated/clarify-payload.json');
 for(const projections of [...Object.values(options),clarify]){
  expect(projections.provider.room.budget).toEqual({visibility:'none'});
  expect(projections.provider.request).toEqual({mine:false,kind:'run_waiting'});
  const bytes=JSON.stringify(projections.provider);
  expect(bytes).not.toMatch(/capCents|committedCents|headroomCents|waitingOnRole/);
  for(const role of ['customer','finance'] as const){
   const brief=projections[role].brief!;
   expect(bytes).not.toContain(brief.latest!.softFields.notes);
   if('deadline' in brief.latest!.hardFields) expect(bytes).not.toContain(brief.latest!.hardFields.deadline);
   if('capCents' in brief.latest!.hardFields){
    const cap=brief.latest!.hardFields.capCents;
    const committed=brief.finance!.committedCents;
    for(const amount of [cap,committed,cap-committed]){
     // Zero is also public metadata; assert private amount values in amount slots.
     if(amount===0)expect(bytes).not.toMatch(/"(?:cents|amountCents)":0(?:,|})/);
     else expect(bytes).not.toContain(String(amount));
    }
   }
  }
 }
});

it('W2-6R7-r02 missing pass destination renders server text and stays disabled',()=>{
 const view=buildRoomView('customer','S7');
 if(!view.openRequest?.mine)throw new Error('Expected request');
 const option={...view.openRequest.options[0]!,type:'pass_to_next',text:'Server pass choice',answerable:true};
 delete (option as {toRole?:unknown}).toRole;
 const malformed={...view,openRequest:{...view.openRequest,options:[option]}} as unknown as typeof view;
 const answer=vi.fn();
 render(<RequestScreen view={malformed} onAnswerRequest={answer}/>);
 expect(screen.getByTestId(`request-option-${option.optionKey}`).textContent).toContain('Server pass choice');
 const radio=screen.getByTestId(`request-radio-${option.optionKey}`) as HTMLInputElement;
 expect(radio.disabled).toBe(true);
 fireEvent.click(radio);fireEvent.click(screen.getByTestId('confirm-request-answer'));
 expect(answer).not.toHaveBeenCalled();
});

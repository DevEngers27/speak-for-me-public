import { expect, it } from 'vitest';
import { uiStatusText, waitingText } from './ui';

it('I-FE-5 waiting copy uses a closed kind and role table', () => {
 expect(waitingText('infeasible', 'finance')).toBe('Waiting on Finance to answer about the budget.');
 expect(waitingText('infeasible', 'customer')).toBe('Waiting on Customer to answer about the scope or deadline.');
 expect(waitingText('infeasible', 'provider')).toBe('Waiting on Provider to answer about the catalog.');
 expect(waitingText('agent_failed', 'customer')).toBe('Waiting on Customer to answer about their agent.');
 expect(waitingText('PRIVATE_CANARY', 'finance')).not.toContain('PRIVATE_CANARY');
});
it('13.16 phase and todo banners render templates rather than storage keys', () => {
 expect(uiStatusText('awaiting_approval')).toBe('Review the current proposal');
 expect(uiStatusText('answer_request')).toBe('Choose how to proceed');
 expect(uiStatusText('toString')).toBe('Review your room');
});

it.each(['setup', 'negotiating', 'needs_input', 'awaiting_approval', 'stopped', 'executed', 'closed', 'decide_proposal', 'redecide_proposal', 'answer_request', 'confirm_brief', 'confirm_catalog', 'record_baseline', 'invite', 'invite_member', 'task', 'complete_task'])('13.16 phase/todo %s has template copy', key => { expect(uiStatusText(key)).not.toBe('Review your room'); expect(uiStatusText(key)).not.toBe(key); });

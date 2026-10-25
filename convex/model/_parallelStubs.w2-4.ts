import type {Doc} from '../_generated/dataModel';
import {cents,isoDate,checkProposal,type View} from '@core/engine';
import {scopeChangePlugin as plugin} from '@core/scenarios/scope-change';
import type * as scenario from '@core/scenarios/scope-change';
export {plugin};
export function checkStored(view: View<scenario.ScopeChangeRuleInput>, p: Doc<'proposals'>) {
  return checkProposal(plugin, view, { terms: { ...p.terms, deliveryDate: isoDate(p.terms.deliveryDate), amountCents: cents(p.terms.amountCents) }, lines: p.lines.map(l => ({ ...l, priceCents: cents(l.priceCents) })) });
}

export {scenarioOf} from '../scenarios/registry';
// Fixed public labels for the projected request-effect enum.
export function requestOptionText(type: Doc<'humanRequests'>['options'][number]['effect']['type']) {
  return { raise_cap: 'Raise the cap', drop_items: 'Remove selected items', extend_deadline: 'Extend the deadline', choose_candidate: 'Choose this option', disclose: 'Share this field', retry_turn: 'Retry this turn', pass_to_next: 'Ask the next participant', keep_as_is: 'Keep the current constraints', end_run: 'End this run', blocked: 'Unavailable' }[type];
}

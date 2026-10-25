/** F5: immutable templates; runtime values enter only through typed slots. */
import {publicText} from '../../../core/engine';
import type {Doc} from '../../_generated/dataModel';
import type {Role} from '../common';
const {slot,definePublicTemplates,renderPublicText,renderPublicTemplateFragment,publicCents}=publicText;
const role=slot.enum({customer:'customer',provider:'provider',finance:'finance'});
const field=slot.enum({requiredItemKeys:'requiredItemKeys',preferredItemKeys:'preferredItemKeys',deadline:'deadline',capCents:'capCents',committedCents:'committedCents',headroomCents:'headroomCents'});
const version=slot.integer({min:0,max:Number.MAX_SAFE_INTEGER});
const fragments=definePublicTemplates({
 cap_pair:{slots:{before:slot.amount(),after:slot.amount()},variants:{room:'Finance updated the budget ({before} → {after}), ',buyer:'Finance updated the budget ({before} → {after}), ',owner:'Finance updated the budget ({before} → {after}), '}},
 cap_new:{slots:{after:slot.amount()},variants:{room:'Finance updated the budget ({after}), ',buyer:'Finance updated the budget ({after}), ',owner:'Finance updated the budget ({after}), '}},
 cap_old:{slots:{before:slot.amount()},variants:{room:'Finance updated the budget (previous {before}), ',buyer:'Finance updated the budget (previous {before}), ',owner:'Finance updated the budget (previous {before}), '}},
 change_role:{slots:{role},variants:{room:'{role} updated constraints, ',buyer:'{role} updated constraints, ',owner:'{role} updated constraints, '}},
 fact_amount:{slots:{field,amount:slot.amount()},variants:{room:'{field}: {amount}',buyer:'{field}: {amount}',owner:'{field}: {amount}'}},
 fact_date:{slots:{field,date:slot.date({branded:false})},variants:{room:'{field}: {date}',buyer:'{field}: {date}',owner:'{field}: {date}'}},
 fact_items:{slots:{field,items:slot.list(slot.token(),{minItems:0,maxItems:12})},variants:{room:'{field}: {items}',buyer:'{field}: {items}',owner:'{field}: {items}'}},
 fact_withdrawn:{slots:{field},variants:{room:'{field} withdrawn',buyer:'{field} withdrawn',owner:'{field} withdrawn'}},
 fact_removed:{slots:{field},variants:{room:'{field} is no longer shared with you',buyer:'{field} is no longer shared with you',owner:'{field} is no longer shared with you'}},
 amount:{slots:{amount:slot.amount()},variants:{room:': {amount}',buyer:': {amount}',owner:': {amount}'}},
 cause:{slots:{cause:slot.enum({room_opened:'room_opened',brief_confirmed:'brief_confirmed',catalog_changed:'catalog_changed',human_answer:'human_answer',clock:'clock',scenario_migrated:'scenario_migrated'})},variants:{room:'{cause}, ',buyer:'{cause}, ',owner:'{cause}, '}},
 request:{slots:{kind:slot.enum({clarify:'clarify',infeasible:'infeasible',needs_tradeoff:'needs_tradeoff',agent_failed:'agent_failed',rounds_exhausted:'rounds_exhausted',agent_escalated:'agent_escalated'})},variants:{room:': {kind}',buyer:': {kind}',owner:': {kind}'}},
});
const detail=slot.optionalFragment(Object.keys(fragments).map(key=>`${key}:room`));
export const TIMELINE_TEMPLATES=definePublicTemplates({
 room_created:{slots:{},variants:{room:'Room created',buyer:'Room created',owner:'Room created'}},
 member_joined:{slots:{},variants:{room:'Member joined',buyer:'Member joined',owner:'Member joined'}},
 invite_created:{slots:{},variants:{room:'Invite created',buyer:'Invite created',owner:'Invite created'}},
 room_opened:{slots:{},variants:{room:'Room opened',buyer:'Room opened',owner:'Room opened'}},
 brief_soft_updated:{slots:{},variants:{room:'You updated guidance for your agent',buyer:'You updated guidance for your agent',owner:'You updated guidance for your agent'}},
 brief_confirmed:{slots:{role,version},variants:{room:'{role} confirmed a brief',buyer:'{role} confirmed brief v{version}',owner:'You confirmed brief v{version}'}},
 baseline_recorded:{slots:{detail},variants:{room:'Committed baseline recorded',buyer:'Committed baseline recorded{detail}',owner:'Committed baseline recorded{detail}'}},
 catalog_item_confirmed:{slots:{},variants:{room:'Catalog item confirmed',buyer:'Catalog item confirmed',owner:'Catalog item confirmed'}},
 catalog_item_retired:{slots:{},variants:{room:'Catalog item retired',buyer:'Catalog item retired',owner:'Catalog item retired'}},
 disclosure_changed:{slots:{role,detail},variants:{room:'{role} updated what they share',buyer:'{detail}',owner:'{detail}'}},
 constraints_changed:{slots:{version,detail},variants:{room:'Constraints changed (v{version})',buyer:'Constraints changed ({detail}v{version})',owner:'Constraints changed ({detail}v{version})'}},
 run_started:{slots:{},variants:{room:'Run started',buyer:'Run started',owner:'Run started'}},
 run_awaiting_approval:{slots:{},variants:{room:'Run awaiting approval',buyer:'Run awaiting approval',owner:'Run awaiting approval'}},
 run_needs_input:{slots:{detail},variants:{room:'Negotiation is waiting',buyer:'Action needed{detail}',owner:'Action needed{detail}'}},
 human_request_opened:{slots:{detail},variants:{room:'Negotiation is waiting',buyer:'Action needed{detail}',owner:'Action needed{detail}'}},
 human_request_answered:{slots:{},variants:{room:'Negotiation resumed',buyer:'Human request answered',owner:'Human request answered'}},
 human_request_closed:{slots:{},variants:{room:'Human request closed',buyer:'Human request closed',owner:'Human request closed'}},
 run_resumed:{slots:{},variants:{room:'Run resumed',buyer:'Run resumed',owner:'Run resumed'}},
 run_renegotiation_requested:{slots:{},variants:{room:'Run renegotiation requested',buyer:'Run renegotiation requested',owner:'Run renegotiation requested'}},
 run_ended:{slots:{},variants:{room:'Run ended',buyer:'Run ended',owner:'Run ended'}},
 turn_scheduled:{slots:{},variants:{room:'Turn scheduled',buyer:'Turn scheduled',owner:'Turn scheduled'}},
 turn_completed:{slots:{},variants:{room:'Turn completed',buyer:'Turn completed',owner:'Turn completed'}},
 turn_failed:{slots:{role,failure:slot.enum({timeout:'timeout',invalid_output:'invalid_output',error:'error',refused:'refused'})},variants:{room:'{role} agent finished',buyer:'{role} agent finished',owner:'Agent failed ({failure})'}},
 turn_rejected_stale:{slots:{},variants:{room:'Turn rejected stale',buyer:'Turn rejected stale',owner:'Turn rejected stale'}},
 proposal_created:{slots:{},variants:{room:'Proposal created',buyer:'Proposal created',owner:'Proposal created'}},
 proposal_status_changed:{slots:{},variants:{room:'Proposal status changed',buyer:'Proposal status changed',owner:'Proposal status changed'}},
 reapproval_required:{slots:{},variants:{room:'Reapproval required',buyer:'Reapproval required',owner:'Reapproval required'}},
 approval_recorded:{slots:{},variants:{room:'Approval recorded',buyer:'Approval recorded',owner:'Approval recorded'}},
 room_executed:{slots:{},variants:{room:'Room executed',buyer:'Room executed',owner:'Room executed'}},
 task_completed:{slots:{},variants:{room:'Task completed',buyer:'Task completed',owner:'Task completed'}},
 room_closed:{slots:{},variants:{room:'Room closed',buyer:'Room closed',owner:'Room closed'}},
 follow_up_started:{slots:{},variants:{room:'Follow up started',buyer:'Follow up started',owner:'Follow up started'}},
 pii_redacted:{slots:{},variants:{room:'Pii redacted',buyer:'Pii redacted',owner:'Pii redacted'}},
});
type FactField=publicText.PublicTemplateFields<typeof fragments.fact_removed>['field'];
export function factDetail(field:string,value:Doc<'sharedFacts'>['value'],removed:boolean):publicText.Fragment {
 const key=field as FactField; // The closed enum slot validates even a cast field at runtime.
 if(removed)return renderPublicTemplateFragment(fragments.fact_removed,{field:key});
 if(value===null)return renderPublicTemplateFragment(fragments.fact_withdrawn,{field:key});
 switch(value.kind){
  case 'cents':return renderPublicTemplateFragment(fragments.fact_amount,{field:key,amount:publicCents(value.cents)});
  case 'date':return renderPublicTemplateFragment(fragments.fact_date,{field:key,date:value.date});
  case 'itemKeys':return renderPublicTemplateFragment(fragments.fact_items,{field:key,items:value.itemKeys});
  case 'enum':throw new TypeError('scope_change declares no enum-valued shared fields');
 }
}
export type TimelineDetails={owner:boolean;fact:publicText.Fragment|null;amount:number|null;cause:string|null;requestKind:string|null;constraintDetail?:publicText.Fragment|null};
export function renderTimelineEvent(payload:Doc<'events'>['payload'],viewer:Role,details:TimelineDetails):string {
 const variant=details.owner?'owner':viewer==='provider'?'room':'buyer';
 switch(payload.type){
  case 'brief_soft_updated':return renderPublicText(TIMELINE_TEMPLATES.brief_soft_updated,{},'owner');
  case 'brief_confirmed':return renderPublicText(TIMELINE_TEMPLATES.brief_confirmed,{role:payload.role,version:payload.version},variant);
  case 'disclosure_changed':return renderPublicText(TIMELINE_TEMPLATES.disclosure_changed,{role:payload.fromRole,detail:details.fact},details.fact?(details.owner?'owner':'buyer'):'room');
  case 'baseline_recorded':return renderPublicText(TIMELINE_TEMPLATES.baseline_recorded,{detail:details.amount===null?null:renderPublicTemplateFragment(fragments.amount,{amount:publicCents(details.amount)})},details.amount===null?'room':variant);
  case 'constraints_changed':return renderPublicText(TIMELINE_TEMPLATES.constraints_changed,{version:payload.toVersion,detail:details.constraintDetail??(details.cause===null?null:renderPublicTemplateFragment(fragments.cause,{cause:details.cause as publicText.PublicTemplateFields<typeof fragments.cause>['cause']}))},variant);
  case 'run_needs_input':case 'human_request_opened':return renderPublicText(TIMELINE_TEMPLATES[payload.type],{detail:details.requestKind===null?null:renderPublicTemplateFragment(fragments.request,{kind:details.requestKind as publicText.PublicTemplateFields<typeof fragments.request>['kind']})},variant);
  case 'turn_failed':return renderPublicText(TIMELINE_TEMPLATES.turn_failed,{role:payload.role,failure:payload.failureKind},variant);
  case 'room_created':
  case 'member_joined':
  case 'invite_created':
  case 'room_opened':
  case 'catalog_item_confirmed':
  case 'catalog_item_retired':
  case 'run_started':
  case 'run_awaiting_approval':
  case 'human_request_answered':
  case 'human_request_closed':
  case 'run_resumed':
  case 'run_renegotiation_requested':
  case 'run_ended':
  case 'turn_scheduled':
  case 'turn_completed':
  case 'turn_rejected_stale':
  case 'proposal_created':
  case 'proposal_status_changed':
  case 'reapproval_required':
  case 'approval_recorded':
  case 'room_executed':
  case 'task_completed':
  case 'room_closed':
  case 'follow_up_started':
  case 'pii_redacted':{const template:publicText.PublicTemplateDefinition<string,publicText.AudienceVariantTemplates,Record<never,never>>=TIMELINE_TEMPLATES[payload.type];return renderPublicText(template,{},variant);}
 }
}

// W2-3: numeric changes cross the timeline boundary only in validated fragments.
export function constraintBudgetDetail(before:number|undefined,after:number|undefined):publicText.Fragment|null{
 if(before!==undefined&&after!==undefined)return renderPublicTemplateFragment(fragments.cap_pair,{before:publicCents(before),after:publicCents(after)});
 if(after!==undefined)return renderPublicTemplateFragment(fragments.cap_new,{after:publicCents(after)});
 if(before!==undefined)return renderPublicTemplateFragment(fragments.cap_old,{before:publicCents(before)});
 return null;
}
export function constraintRoleDetail(role:Role){return renderPublicTemplateFragment(fragments.change_role,{role});}

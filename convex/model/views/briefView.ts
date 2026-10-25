import type {MemberCtx} from '../../lib/functions';
import type {Doc} from '../../_generated/dataModel';
import {privacy} from '../../../core/engine';
import {scenarioOf} from '../../scenarios/registry';
import {factRows} from '../sharedFacts';
import {ledgerState,same,type Role} from '../common';
export function copyHard(hard:Doc<'briefs'>['hardFields']):Doc<'briefs'>['hardFields']{
 if(hard.schemaKey==='scope_change.customer.v1')return {schemaKey:hard.schemaKey,requiredItemKeys:hard.requiredItemKeys.map(k=>k),deadline:hard.deadline};
 if(hard.schemaKey==='scope_change.finance.v1')return {schemaKey:hard.schemaKey,capCents:hard.capCents};
 return {schemaKey:hard.schemaKey};
}
export function copySoft(soft:Doc<'briefs'>['softFields']):Doc<'briefs'>['softFields']{
 if(soft.schemaKey==='scope_change.customer.v1')return {schemaKey:soft.schemaKey,preferredItemKeys:soft.preferredItemKeys.map(k=>k),notes:soft.notes};
 return {schemaKey:soft.schemaKey,notes:soft.notes};
}
export async function mineView(ctx:MemberCtx){
 const role=ctx.member.role,plugin=scenarioOf(ctx.room),versions=await ctx.db.query('briefs').withIndex('by_room_role_version',q=>q.eq('roomId',ctx.room._id).eq('role',role)).collect();
 const latest=versions[versions.length-1]??null,facts=(await factRows(ctx,ctx.room._id)).filter(f=>f.fromRole===role);
 const othersSee=(['customer','provider','finance'] as const).filter(r=>r!==role).map(r=>({role:r,fields:privacy.projectSharedFacts(r,facts,undefined,plugin).map(f=>({field:f.field as string,value:f.value as Doc<'sharedFacts'>['value'],asOfBriefVersion:f.asOfBriefVersion as number}))}));
 const history=versions.map((brief,index)=>{const before=versions[index-1]?.hardFields as Record<string,unknown>|undefined;return {version:brief.version,notes:brief.softFields.notes,confirmedAt:brief.confirmedAt,source:brief.source,changedHardFields:Object.entries(brief.hardFields).filter(([key,value])=>key!=='schemaKey'&&!same(before?.[key],value)).map(([key])=>key)};});
 let finance:null|{committedCents:number;baselineRecorded:boolean;baselineSuggestionCents:number|null}=null;
 if(role==='finance'){const ledger=await ledgerState(ctx,ctx.room._id);finance={committedCents:ledger.committedCents,baselineRecorded:!!ledger.baseline,baselineSuggestionCents:null};}
 const disclosures:Record<string,Role[]>={};if(latest)for(const [key,roles]of Object.entries(latest.disclosures))disclosures[key]=roles.map(r=>r);
 return {role,latest:latest?{version:latest.version,hardFields:copyHard(latest.hardFields),softFields:copySoft(latest.softFields),disclosures,confirmedAt:latest.confirmedAt,source:latest.source}:null,versions:history,othersSee,finance};
}

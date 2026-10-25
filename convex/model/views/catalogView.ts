import type {MemberCtx} from '../../lib/functions';
import type {Doc} from '../../_generated/dataModel';
import {catalogRows,currentCatalog} from '../common';
function rowView(row:Doc<'catalogItems'>){return {itemKey:row.itemKey,kind:row.kind,title:row.title,priceCents:row.priceCents,leadDays:row.leadDays,revision:row.revision,editNo:row.editNo,status:row.status,taskTemplates:row.taskTemplates.map(t=>({title:t.title,assigneeRole:t.assigneeRole}))};}
export async function listView(ctx:MemberCtx){const rows=await catalogRows(ctx,ctx.room._id);return {items:currentCatalog(rows).filter(row=>row.status!=='draft').map(rowView),mine:ctx.member.role==='provider'?{drafts:currentCatalog(rows).filter(r=>r.status==='draft').map(rowView),history:rows.map(rowView)}:null};}

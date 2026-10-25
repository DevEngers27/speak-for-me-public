import { v } from 'convex/values';
import { sysQuery } from './lib/functions';
import { replayRuleInput as replay } from './model/constraintReads';
/** Internal audit/test surface. No public route exposes private source refs. */
export const replayRuleInput = sysQuery('constraints.replayRuleInput')({
  args: { roomId: v.id('rooms'), ref: v.object({ constraintsVersion: v.number(), localDate: v.string() }) },
  returns:v.object({viewer:v.literal('system'),localDate:v.string(),capCents:v.optional(v.number()),committedCents:v.optional(v.number()),headroomCents:v.optional(v.number()),requiredItemKeys:v.optional(v.array(v.string())),deadline:v.optional(v.string()),catalog:v.array(v.object({itemKey:v.string(),kind:v.union(v.literal('item'),v.literal('modifier')),revision:v.number(),status:v.union(v.literal('confirmed'),v.literal('retired')),title:v.string(),priceCents:v.number(),leadDays:v.number(),taskTemplates:v.array(v.object({title:v.string(),assigneeRole:v.string()})),provenance:v.union(v.literal('live'),v.literal('seeded'),v.literal('stub'))}))}),
  handler: async(ctx, args) => {const input=await replay(ctx,args.roomId,args.ref);return{...input,viewer:'system' as const,requiredItemKeys:input.requiredItemKeys?[...input.requiredItemKeys]:undefined,catalog:input.catalog.map(row=>({...row,taskTemplates:row.taskTemplates.map(t=>({...t}))}))};},
});

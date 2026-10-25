import { v } from 'convex/values';
import { roleV } from '../../lib/validators';
export const confirmResultV=v.object({status:v.union(v.literal('confirmed'),v.literal('unchanged')),version:v.number(),constraintsVersion:v.number(),bumped:v.boolean()});
export const hardV=v.union(v.object({schemaKey:v.literal('scope_change.customer.v1'),requiredItemKeys:v.array(v.string()),deadline:v.string()}),v.object({schemaKey:v.literal('scope_change.provider.v1')}),v.object({schemaKey:v.literal('scope_change.finance.v1'),capCents:v.number()}));
export const softV=v.union(v.object({schemaKey:v.literal('scope_change.customer.v1'),preferredItemKeys:v.array(v.string()),notes:v.string()}),v.object({schemaKey:v.literal('scope_change.provider.v1'),notes:v.string()}),v.object({schemaKey:v.literal('scope_change.finance.v1'),notes:v.string()}));
export const catalogInputV=v.object({itemKey:v.string(),kind:v.union(v.literal('item'),v.literal('modifier')),title:v.string(),priceCents:v.number(),leadDays:v.number(),taskTemplates:v.array(v.object({title:v.string(),assigneeRole:roleV}))});

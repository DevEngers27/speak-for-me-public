import {v} from 'convex/values';
import schema from '../schema';
import {roleV} from './validators';
export const hardFieldsV=schema.tables.briefs.validator.fields.hardFields;
export const softFieldsV=schema.tables.briefs.validator.fields.softFields;
export const disclosuresV=v.record(v.string(),v.array(roleV));
export const factValueV=schema.tables.sharedFacts.validator.fields.value;
export const confirmResultV=v.object({status:v.union(v.literal('confirmed'),v.literal('unchanged')),version:v.number(),constraintsVersion:v.number(),bumped:v.boolean()});
export const catalogInputV=v.object({itemKey:v.string(),kind:v.union(v.literal('item'),v.literal('modifier')),title:v.string(),priceCents:v.number(),leadDays:v.number(),taskTemplates:v.array(v.object({title:v.string(),assigneeRole:roleV}))});
export const briefSourceV=schema.tables.briefs.validator.fields.source;

export const provenanceV=schema.tables.rooms.validator.fields.provenance;

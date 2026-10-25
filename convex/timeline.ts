import {visibleEvents} from './model/views/visibleEvents';
import {v} from 'convex/values';
import {paginationOptsValidator,paginationResultValidator} from 'convex/server';
import {memberQuery} from './lib/functions';
import {timelineItemV,timelineView} from './model/views/timelineView';
export const page=memberQuery('timeline.page')({args:{roomId:v.id('rooms'),paginationOpts:paginationOptsValidator},returns:v.union(v.null(),paginationResultValidator(timelineItemV)),handler:async(ctx,args)=>{
 const result=await visibleEvents(ctx).order('desc').paginate(args.paginationOpts);
 return {page:await timelineView(ctx,result.page),isDone:result.isDone,continueCursor:result.continueCursor};
}});

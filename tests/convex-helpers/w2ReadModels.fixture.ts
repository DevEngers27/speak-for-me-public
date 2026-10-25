import {expect} from 'vitest';
import {api} from '../../convex/_generated/api';
import {harness} from './w2Execution.fixture';
import {bump} from './w2Constraint.fixture';

/** CE-058: the retained proposal must invite a fresh decision at the new cv. */
export async function retainedApprovalReadModels() {
 const h=await harness();
 await h.approve('customer');
 await bump(h,{cap:490_000});
 for(const role of ['customer','provider','finance'] as const){
  const view=(await h.as(role).query(api.rooms.view,{roomId:h.roomId}))!;
  const inbox=(await h.as(role).query(api.rooms.listMine,{paginationOpts:{numItems:10,cursor:null}}))!.page[0]!;
  expect(view.header.phase).toEqual({phase:'awaiting_approval',proposalVersion:1,pendingRoles:['customer','provider','finance'],youPending:true});
  expect(view.todos.map(todo=>todo.kind)).toEqual(role==='customer'?['redecide_proposal']:['decide_proposal']);
  expect(inbox.phase).toEqual(view.header.phase);
  expect(inbox.topTodo?.kind??null).toBe(view.todos[0]?.kind??null);
  expect(inbox.inboxSection).toBe('needs_you');
  expect(inbox.notice).toBe(role==='customer'?'approval_no_longer_applies':null);
 }
 const result=await h.approve('customer',{expectedConstraintsVersion:2});
 expect(result.status).toBe('recorded');
 const after=(await h.as('customer').query(api.rooms.view,{roomId:h.roomId}))!;
 expect(after.todos).toEqual([]);
}

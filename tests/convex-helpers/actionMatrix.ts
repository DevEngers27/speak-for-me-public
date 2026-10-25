/** W2-1 TC-AUTH-07: later lanes append rows for their public functions. */
import type {Role} from '../../convex/model/common';
export const ACTION_MATRIX:readonly {name:string;kind:'query'|'mutation'|'action';access:'anon'|'user'|'member';roles?:readonly Role[];creatorOnly?:boolean}[]=[
 {name:'health.ping',kind:'query',access:'anon'},
 {name:'users.viewer',kind:'query',access:'user'},{name:'users.ensureViewer',kind:'mutation',access:'user'},
 {name:'rooms.create',kind:'mutation',access:'user'},{name:'rooms.close',kind:'mutation',access:'member',creatorOnly:true},{name:'rooms.view',kind:'query',access:'member'},{name:'rooms.listMine',kind:'query',access:'user'},
 {name:'invites.create',kind:'mutation',access:'member',creatorOnly:true},{name:'invites.createLink',kind:'action',access:'member',creatorOnly:true},{name:'invites.accept',kind:'mutation',access:'user'},{name:'invites.listMine',kind:'query',access:'user'},
 {name:'briefs.updateSoft',kind:'mutation',access:'member'},{name:'humanRequests.get',kind:'query',access:'member'},
 {name:'briefs.confirm',kind:'mutation',access:'member'},{name:'briefs.mine',kind:'query',access:'member'},
 {name:'budget.setCap',kind:'mutation',access:'member',roles:['finance']},{name:'ledger.recordBaseline',kind:'mutation',access:'member',roles:['finance']},{name:'sharedFacts.add',kind:'mutation',access:'member'},
 {name:'catalog.confirm',kind:'mutation',access:'member',roles:['provider']},{name:'catalog.retire',kind:'mutation',access:'member',roles:['provider']},{name:'catalog.list',kind:'query',access:'member'},{name:'timeline.page',kind:'query',access:'member'},
 // W2-2 integration: authorization rows for execution lifecycle.
 {name:'approvals.record',kind:'mutation',access:'member'},
 {name:'proposals.get',kind:'query',access:'member'},
 {name:'executions.forRoom',kind:'query',access:'member'},
 {name:'tasks.markDone',kind:'mutation',access:'member'},
 {name:'rooms.startFollowUp',kind:'mutation',access:'member'},
 // W2-3: owned constraint preview.
 {name:'rooms.previewChange',kind:'query',access:'member'},
 // W2-4: lifecycle entry points.
 {name:'runs.start',kind:'mutation',access:'member'},
 {name:'runs.cancel',kind:'mutation',access:'member',creatorOnly:true},
 {name:'runs.requestRenegotiation',kind:'mutation',access:'member',creatorOnly:true},
 {name:'runs.retryTurn',kind:'mutation',access:'member',roles:['customer']},
 {name:'humanRequests.answer',kind:'mutation',access:'member',roles:['customer']},
 {name:'turns.mine',kind:'query',access:'member'},
];

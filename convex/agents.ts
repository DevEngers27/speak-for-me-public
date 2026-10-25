import {nowMs} from './lib/time';
import {v} from 'convex/values';
import {makeFunctionReference} from 'convex/server';
import {sysQuery,sysAction,sysMutation} from './lib/functions';
import {actorV,type FailOutcome,type ModelResponse} from './model/runtimeValidators';
import {loadAttemptContext,attemptContextV,type TurnContext,type AttemptInput} from './model/agents/attemptContext';
import {driverFor,DriverTransportError,type NormalizedResponse} from './model/agents/drivers';
import {classifyResponse,selectOutputSchema} from './model/agents/outputSchema';
import {classifyError,toAttemptOutcome} from './model/agents/modelGateway';
import {watchdog as watchdogTx} from './model/runs';
import {completeRef,failRef} from './model/runtimeRefs';
import {type TurnSemanticsView} from '@core/engine';
import type {Doc} from './_generated/dataModel';
import {readConfig} from './lib/config';
const loadRef=makeFunctionReference<'query',{attemptId:import('./_generated/dataModel').Id<'attempts'>},TurnContext|null>('agents:loadTurnContext');
export const loadTurnContext=sysQuery('agents.loadTurnContext')({returns:attemptContextV,args:{attemptId:v.id('attempts')},handler:(ctx,{attemptId})=>loadAttemptContext(ctx,attemptId)});
export const runAttempt=sysAction('agents.runAttempt')({args:{attemptId:v.id('attempts'),actorUserId:actorV},returns:v.null(),handler:async(ctx,args)=>{
 const startedAt=nowMs(ctx);
 let outcome:FailOutcome={kind:'stale_context'};
 let move:NonNullable<Doc<'turns'>['result']>|undefined;
 let response:ModelResponse|undefined;
 let schemaVersion='v1';
 let rationaleTruncated=false;
 try{
  const context=await ctx.runQuery(loadRef,{attemptId:args.attemptId});
  if(context){
   const config=readConfig();
   if(context.agentMode==='live'&&!config.agentsEnabled)outcome={kind:'error',errorCode:'agents_disabled',response:null};
   else if(context.agentMode==='live'&&!config.configValid)outcome={kind:'error',errorCode:'config_invalid',response:null};
   else{
    const input=JSON.parse(context.inputJson) as AttemptInput;
    const semantics=JSON.parse(context.semanticsJson) as TurnSemanticsView;
    schemaVersion=selectOutputSchema(input.spec).schemaVersion;
    const raw=await driverFor(context.agentMode).runTurn(input,{spec:input.spec});
    response=toResponse(raw);
    const decision=classifyResponse(raw,semantics,input.spec);
    if(decision.status==='completed'){move=decision.turn as NonNullable<Doc<'turns'>['result']>;rationaleTruncated=decision.rationaleTruncated;}
    else outcome={kind:decision.status,errorCode:'errorCode' in decision?decision.errorCode:decision.reasonCode,response,...('issuePaths' in decision?{issuePaths:[...decision.issuePaths]}:{})};
   }
  }
 }catch(error){
  if(error instanceof DriverTransportError){
   const result=error.result,u=result.totalUsage;
   if(result.usage!==null||u.inputTokens+u.outputTokens+u.cacheCreationInputTokens+u.cacheReadInputTokens>0)response={usage:{inputTokens:u.inputTokens,outputTokens:u.outputTokens,thinkingTokens:u.thinkingTokens,cacheCreationInputTokens:u.cacheCreationInputTokens,cacheReadInputTokens:u.cacheReadInputTokens},stopReason:result.stopReason??'',stopCategory:result.stopCategory,requestId:result.requestId,messageId:result.messageId,responseModel:result.responseModel,rawText:''};
   outcome={kind:toAttemptOutcome(result).status as 'timeout'|'error',errorCode:result.errorCode,response:response??null};
  }else{const failure=classifyError(error);outcome={kind:failure.errorCode==='model_timeout'?'timeout':'error',errorCode:failure.errorCode,response:response??null};}
  move=undefined;
 }
 const latencyMs=nowMs(ctx)-startedAt;
 // Commit failure never re-enters the paid driver. The watchdog handles a double commit defect.
 try{if(move&&response)await ctx.runMutation(completeRef,{...args,move,response,schemaVersion,latencyMs,rationaleTruncated});else await ctx.runMutation(failRef,{...args,outcome,schemaVersion,latencyMs});}
 catch{await ctx.runMutation(failRef,{...args,outcome:{kind:'error',errorCode:'internal',response:response??null},schemaVersion,latencyMs}).catch(()=>{});}
 return null;
}});
function toResponse(raw:NormalizedResponse):ModelResponse{return {usage:{inputTokens:raw.usage.inputTokens,outputTokens:raw.usage.outputTokens,thinkingTokens:raw.usage.thinkingTokens,cacheCreationInputTokens:raw.usage.cacheCreationInputTokens,cacheReadInputTokens:raw.usage.cacheReadInputTokens},stopReason:raw.stopReason??'',stopCategory:raw.stopCategory,requestId:raw.requestId,messageId:null,responseModel:raw.responseModel,rawText:raw.firstText??''};}
export const watchdog=sysMutation('agents.watchdog')({args:{attemptId:v.id('attempts')},returns:v.null(),handler:async(ctx,{attemptId})=>{await watchdogTx(ctx,attemptId);return null;}});

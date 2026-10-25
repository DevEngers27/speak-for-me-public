import { makeFunctionReference } from 'convex/server';
import type { Id } from '../_generated/dataModel';
import type { BeginResult, FailOutcome, ModelResponse } from './runtimeValidators';
import type { Doc } from '../_generated/dataModel';
export const runAttemptRef = makeFunctionReference<'action', { attemptId: Id<'attempts'>; actorUserId: Id<'users'> | null }, null>('agents:runAttempt');
export const watchdogRef = makeFunctionReference<'mutation', { attemptId: Id<'attempts'> }, null>('agents:watchdog');
export const beginRef = makeFunctionReference<'mutation', { turnId: Id<'turns'>; origin: Doc<'attempts'>['origin']; actorUserId: Id<'users'> | null; retryNote?: string }, BeginResult>('turns:beginAttempt');
export const completeRef = makeFunctionReference<'mutation', { attemptId: Id<'attempts'>; actorUserId: Id<'users'> | null; move: NonNullable<Doc<'turns'>['result']>; response: ModelResponse; schemaVersion: string; latencyMs: number; rationaleTruncated?:boolean }, null>('turns:complete');
export const failRef = makeFunctionReference<'mutation', { attemptId: Id<'attempts'>; actorUserId: Id<'users'> | null; outcome: FailOutcome; schemaVersion?: string; latencyMs: number }, null>('turns:fail');

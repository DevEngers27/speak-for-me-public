/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as agents from "../agents.js";
import type * as approvals from "../approvals.js";
import type * as briefs from "../briefs.js";
import type * as budget from "../budget.js";
import type * as catalog from "../catalog.js";
import type * as clock from "../clock.js";
import type * as constraints from "../constraints.js";
import type * as crons from "../crons.js";
import type * as devProbes from "../devProbes.js";
import type * as executions from "../executions.js";
import type * as health from "../health.js";
import type * as humanRequests from "../humanRequests.js";
import type * as invites from "../invites.js";
import type * as ledger from "../ledger.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_configHealth from "../lib/configHealth.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_db from "../lib/db.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_eventPayload from "../lib/eventPayload.js";
import type * as lib_fixtureSchema from "../lib/fixtureSchema.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_opsLog from "../lib/opsLog.js";
import type * as lib_privacyFields from "../lib/privacyFields.js";
import type * as lib_probeFixtures from "../lib/probeFixtures.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_resetRooms from "../lib/resetRooms.js";
import type * as lib_returns from "../lib/returns.js";
import type * as lib_schemaTypes from "../lib/schemaTypes.js";
import type * as lib_scopeChangeFixture from "../lib/scopeChangeFixture.js";
import type * as lib_seedChain from "../lib/seedChain.js";
import type * as lib_seedPolicy from "../lib/seedPolicy.js";
import type * as lib_sourceValidators from "../lib/sourceValidators.js";
import type * as lib_status from "../lib/status.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_validators from "../lib/validators.js";
import type * as model_agents_attemptContext from "../model/agents/attemptContext.js";
import type * as model_agents_context from "../model/agents/context.js";
import type * as model_agents_drivers from "../model/agents/drivers.js";
import type * as model_agents_modelGateway from "../model/agents/modelGateway.js";
import type * as model_agents_models from "../model/agents/models.js";
import type * as model_agents_outputSchema from "../model/agents/outputSchema.js";
import type * as model_agents_pricing from "../model/agents/pricing.js";
import type * as model_agents_warmVariants from "../model/agents/warmVariants.js";
import type * as model_approvalHelpers from "../model/approvalHelpers.js";
import type * as model_attempts from "../model/attempts.js";
import type * as model_briefs from "../model/briefs.js";
import type * as model_catalog from "../model/catalog.js";
import type * as model_clock from "../model/clock.js";
import type * as model_clockDate from "../model/clockDate.js";
import type * as model_common from "../model/common.js";
import type * as model_constraintInput from "../model/constraintInput.js";
import type * as model_constraintRates from "../model/constraintRates.js";
import type * as model_constraintReads from "../model/constraintReads.js";
import type * as model_constraints from "../model/constraints.js";
import type * as model_constraints_adapter from "../model/constraints/adapter.js";
import type * as model_constraints_fixedPoint from "../model/constraints/fixedPoint.js";
import type * as model_constraints_protocol from "../model/constraints/protocol.js";
import type * as model_constraints_readiness from "../model/constraints/readiness.js";
import type * as model_constraints_wire from "../model/constraints/wire.js";
import type * as model_constraints_writeGuards from "../model/constraints/writeGuards.js";
import type * as model_events from "../model/events.js";
import type * as model_executions from "../model/executions.js";
import type * as model_followUp from "../model/followUp.js";
import type * as model_humanRequests from "../model/humanRequests.js";
import type * as model_invites from "../model/invites.js";
import type * as model_ledger from "../model/ledger.js";
import type * as model_members from "../model/members.js";
import type * as model_roomSnapshot from "../model/roomSnapshot.js";
import type * as model_rooms from "../model/rooms.js";
import type * as model_runs from "../model/runs.js";
import type * as model_runtimeRefs from "../model/runtimeRefs.js";
import type * as model_runtimeSources from "../model/runtimeSources.js";
import type * as model_runtimeTx from "../model/runtimeTx.js";
import type * as model_runtimeValidators from "../model/runtimeValidators.js";
import type * as model_sharedFacts from "../model/sharedFacts.js";
import type * as model_turns from "../model/turns.js";
import type * as model_users from "../model/users.js";
import type * as model_views_briefView from "../model/views/briefView.js";
import type * as model_views_catalogView from "../model/views/catalogView.js";
import type * as model_views_constraintRunView from "../model/views/constraintRunView.js";
import type * as model_views_decisionView from "../model/views/decisionView.js";
import type * as model_views_executionWhy from "../model/views/executionWhy.js";
import type * as model_views_requestOptions from "../model/views/requestOptions.js";
import type * as model_views_roomView from "../model/views/roomView.js";
import type * as model_views_timelineTemplates from "../model/views/timelineTemplates.js";
import type * as model_views_timelineView from "../model/views/timelineView.js";
import type * as model_views_validators from "../model/views/validators.js";
import type * as model_views_visibleEvents from "../model/views/visibleEvents.js";
import type * as ops from "../ops.js";
import type * as privacy from "../privacy.js";
import type * as proposals from "../proposals.js";
import type * as rooms from "../rooms.js";
import type * as runs from "../runs.js";
import type * as scenarios_registry from "../scenarios/registry.js";
import type * as seed from "../seed.js";
import type * as sharedFacts from "../sharedFacts.js";
import type * as tasks from "../tasks.js";
import type * as testing from "../testing.js";
import type * as timeline from "../timeline.js";
import type * as turns from "../turns.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  approvals: typeof approvals;
  briefs: typeof briefs;
  budget: typeof budget;
  catalog: typeof catalog;
  clock: typeof clock;
  constraints: typeof constraints;
  crons: typeof crons;
  devProbes: typeof devProbes;
  executions: typeof executions;
  health: typeof health;
  humanRequests: typeof humanRequests;
  invites: typeof invites;
  ledger: typeof ledger;
  "lib/config": typeof lib_config;
  "lib/configHealth": typeof lib_configHealth;
  "lib/crypto": typeof lib_crypto;
  "lib/db": typeof lib_db;
  "lib/errors": typeof lib_errors;
  "lib/eventPayload": typeof lib_eventPayload;
  "lib/fixtureSchema": typeof lib_fixtureSchema;
  "lib/functions": typeof lib_functions;
  "lib/opsLog": typeof lib_opsLog;
  "lib/privacyFields": typeof lib_privacyFields;
  "lib/probeFixtures": typeof lib_probeFixtures;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/resetRooms": typeof lib_resetRooms;
  "lib/returns": typeof lib_returns;
  "lib/schemaTypes": typeof lib_schemaTypes;
  "lib/scopeChangeFixture": typeof lib_scopeChangeFixture;
  "lib/seedChain": typeof lib_seedChain;
  "lib/seedPolicy": typeof lib_seedPolicy;
  "lib/sourceValidators": typeof lib_sourceValidators;
  "lib/status": typeof lib_status;
  "lib/time": typeof lib_time;
  "lib/validators": typeof lib_validators;
  "model/agents/attemptContext": typeof model_agents_attemptContext;
  "model/agents/context": typeof model_agents_context;
  "model/agents/drivers": typeof model_agents_drivers;
  "model/agents/modelGateway": typeof model_agents_modelGateway;
  "model/agents/models": typeof model_agents_models;
  "model/agents/outputSchema": typeof model_agents_outputSchema;
  "model/agents/pricing": typeof model_agents_pricing;
  "model/agents/warmVariants": typeof model_agents_warmVariants;
  "model/approvalHelpers": typeof model_approvalHelpers;
  "model/attempts": typeof model_attempts;
  "model/briefs": typeof model_briefs;
  "model/catalog": typeof model_catalog;
  "model/clock": typeof model_clock;
  "model/clockDate": typeof model_clockDate;
  "model/common": typeof model_common;
  "model/constraintInput": typeof model_constraintInput;
  "model/constraintRates": typeof model_constraintRates;
  "model/constraintReads": typeof model_constraintReads;
  "model/constraints": typeof model_constraints;
  "model/constraints/adapter": typeof model_constraints_adapter;
  "model/constraints/fixedPoint": typeof model_constraints_fixedPoint;
  "model/constraints/protocol": typeof model_constraints_protocol;
  "model/constraints/readiness": typeof model_constraints_readiness;
  "model/constraints/wire": typeof model_constraints_wire;
  "model/constraints/writeGuards": typeof model_constraints_writeGuards;
  "model/events": typeof model_events;
  "model/executions": typeof model_executions;
  "model/followUp": typeof model_followUp;
  "model/humanRequests": typeof model_humanRequests;
  "model/invites": typeof model_invites;
  "model/ledger": typeof model_ledger;
  "model/members": typeof model_members;
  "model/roomSnapshot": typeof model_roomSnapshot;
  "model/rooms": typeof model_rooms;
  "model/runs": typeof model_runs;
  "model/runtimeRefs": typeof model_runtimeRefs;
  "model/runtimeSources": typeof model_runtimeSources;
  "model/runtimeTx": typeof model_runtimeTx;
  "model/runtimeValidators": typeof model_runtimeValidators;
  "model/sharedFacts": typeof model_sharedFacts;
  "model/turns": typeof model_turns;
  "model/users": typeof model_users;
  "model/views/briefView": typeof model_views_briefView;
  "model/views/catalogView": typeof model_views_catalogView;
  "model/views/constraintRunView": typeof model_views_constraintRunView;
  "model/views/decisionView": typeof model_views_decisionView;
  "model/views/executionWhy": typeof model_views_executionWhy;
  "model/views/requestOptions": typeof model_views_requestOptions;
  "model/views/roomView": typeof model_views_roomView;
  "model/views/timelineTemplates": typeof model_views_timelineTemplates;
  "model/views/timelineView": typeof model_views_timelineView;
  "model/views/validators": typeof model_views_validators;
  "model/views/visibleEvents": typeof model_views_visibleEvents;
  ops: typeof ops;
  privacy: typeof privacy;
  proposals: typeof proposals;
  rooms: typeof rooms;
  runs: typeof runs;
  "scenarios/registry": typeof scenarios_registry;
  seed: typeof seed;
  sharedFacts: typeof sharedFacts;
  tasks: typeof tasks;
  testing: typeof testing;
  timeline: typeof timeline;
  turns: typeof turns;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

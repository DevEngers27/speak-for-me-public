import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

export function makeT() {
  return convexTest(schema, modules);
}
export type T = ReturnType<typeof makeT>;

export const ISSUER = "https://clerk.example.test";

export function as(t: T, who: "alice" | "bob" | "carol") {
  return t.withIdentity({ subject: `user_${who}`, issuer: ISSUER, name: who });
}

/** Seed: alice (provisioned), a room at constraintVersion 1, proposal v1. */
export async function seed(t: T) {
  const alice = as(t, "alice");
  const aliceId = await alice.mutation(api.users.ensureUser, {});
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      title: "Scope change",
      status: "negotiating",
      constraintVersion: 1,
      ownerId: aliceId,
      archivedAt: null,
    }),
  );
  const proposalId = await t.run((ctx) =>
    ctx.db.insert("proposals", {
      roomId,
      version: 1,
      constraintVersion: 1,
      terms: { priceCents: 1_200_000, scopeItemIds: ["sso", "audit-log"], dueDate: "2026-12-01" },
    }),
  );
  return { alice, aliceId, roomId, proposalId };
}

export async function countRows(
  t: T,
  table: "executions" | "commitments" | "approvals" | "runs" | "users" | "events",
) {
  return await t.run(async (ctx) => (await ctx.db.query(table).collect()).length);
}

export async function countEvents(t: T, kind: string) {
  return await t.run(
    async (ctx) =>
      (await ctx.db.query("events").withIndex("by_kind", (q) => q.eq("kind", kind)).collect())
        .length,
  );
}

export async function scheduledJobs(t: T) {
  return await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
}

/** Await a rejection and return the error for inspection. */
export async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected promise to reject");
}

export function expectAppError(e: unknown, code: string) {
  expect(e).toBeInstanceOf(ConvexError);
  expect((e as ConvexError<{ code: string }>).data.code).toBe(code);
}

export function log(label: string, value: unknown) {
  console.log(`[spike] ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

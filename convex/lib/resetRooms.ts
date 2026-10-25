import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { appError } from "./errors";
import { deleteMaintenanceRow } from "./db";

export const RESET_DOCUMENT_LIMIT = 2000;

type RoomId = Id<"rooms">;
type AnyId =
  | Id<"turns"> | Id<"approvals"> | Id<"rawOutputs"> | Id<"attempts"> | Id<"proposals"> | Id<"runs">
  | Id<"events"> | Id<"tasks"> | Id<"changeOrders"> | Id<"executions"> | Id<"humanRequests">
  | Id<"constraintRevisions"> | Id<"ledgerEntries"> | Id<"catalogItems"> | Id<"sharedFacts">
  | Id<"briefs"> | Id<"invites"> | Id<"members"> | Id<"rooms">;

async function deleteIds(ctx: MutationCtx, ids: readonly { _id: AnyId }[], budget: number): Promise<{ deleted: number; hitCap: boolean }> {
  const page = ids.slice(0, budget);
  for (const row of page) await deleteMaintenanceRow(ctx, row._id);
  return { deleted: page.length, hitCap: page.length === budget && ids.length >= budget };
}

/** Delete non-live rooms and their child rows. At most `limit` documents per call. */
export async function deleteNonLiveRooms(ctx: MutationCtx, limit = RESET_DOCUMENT_LIMIT): Promise<{ roomsDeleted: number; rowsDeleted: number; more: boolean }> {
  let roomsDeleted = 0;
  let rowsDeleted = 0;
  let budget = limit;
  const rooms = (await ctx.db.query("rooms").collect()).filter((room) => room.provenance !== "live");
  for (const room of rooms) {
    if (budget <= 0) break;
    const outcome = await deleteRoomChildren(ctx, room._id, budget);
    rowsDeleted += outcome.deleted;
    budget -= outcome.deleted;
    if (outcome.hitCap || budget <= 0) break;
    await deleteMaintenanceRow(ctx, room._id);
    roomsDeleted += 1;
    rowsDeleted += 1;
    budget -= 1;
  }
  const more = (await ctx.db.query("rooms").collect()).some((room) => room.provenance !== "live");
  return { roomsDeleted, rowsDeleted, more };
}

async function deleteRoomChildren(ctx: MutationCtx, roomId: RoomId, budget: number): Promise<{ deleted: number; hitCap: boolean }> {
  let deleted = 0;
  const spend = async (ids: readonly { _id: AnyId }[]): Promise<boolean> => {
    const remaining = budget - deleted;
    if (remaining <= 0) return true;
    const outcome = await deleteIds(ctx, ids, remaining);
    deleted += outcome.deleted;
    return outcome.hitCap;
  };

  const runs = await ctx.db.query("runs").withIndex("by_room_runNo", (q) => q.eq("roomId", roomId)).collect();
  const turns = [];
  for (const run of runs) {
    turns.push(...await ctx.db.query("turns").withIndex("by_run_turnSeq", (q) => q.eq("runId", run._id)).collect());
  }
  if (await spend(turns)) return { deleted, hitCap: true };

  const proposals = await ctx.db.query("proposals").withIndex("by_room_version", (q) => q.eq("roomId", roomId)).collect();
  const approvals = [];
  for (const proposal of proposals) {
    approvals.push(...await ctx.db.query("approvals").withIndex("by_proposal_user", (q) => q.eq("proposalId", proposal._id)).collect());
  }
  if (await spend(approvals)) return { deleted, hitCap: true };

  const attempts = await ctx.db.query("attempts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  const raws = [];
  for (const attempt of attempts) {
    raws.push(...await ctx.db.query("rawOutputs").withIndex("by_attempt", (q) => q.eq("attemptId", attempt._id)).collect());
  }
  if (await spend(raws)) return { deleted, hitCap: true };
  if (await spend(attempts)) return { deleted, hitCap: true };
  if (await spend(proposals)) return { deleted, hitCap: true };
  if (await spend(runs)) return { deleted, hitCap: true };

  const indexed = [
    await ctx.db.query("events").withIndex("by_room_order", (q) => q.eq("roomId", roomId)).collect(),
    await ctx.db.query("tasks").withIndex("by_room_assignee", (q) => q.eq("roomId", roomId)).collect(),
    await ctx.db.query("changeOrders").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect(),
    await ctx.db.query("executions").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect(),
    await ctx.db.query("humanRequests").withIndex("by_room_status", (q) => q.eq("roomId", roomId)).collect(),
    await ctx.db.query("constraintRevisions").withIndex("by_room_version", (q) => q.eq("roomId", roomId)).collect(),
    await ctx.db.query("ledgerEntries").withIndex("by_room_kind", (q) => q.eq("roomId", roomId)).collect(),
    await ctx.db.query("catalogItems").withIndex("by_room_item", (q) => q.eq("roomId", roomId)).collect(),
    await ctx.db.query("sharedFacts").withIndex("by_room_from_field", (q) => q.eq("roomId", roomId)).collect(),
    await ctx.db.query("briefs").withIndex("by_room_role_version", (q) => q.eq("roomId", roomId)).collect(),
    await ctx.db.query("invites").withIndex("by_room_role", (q) => q.eq("roomId", roomId)).collect(),
    await ctx.db.query("members").withIndex("by_room_role", (q) => q.eq("roomId", roomId)).collect(),
  ];
  for (const page of indexed) {
    if (await spend(page)) return { deleted, hitCap: true };
  }
  return { deleted, hitCap: false };
}

/** Probe cleanup is explicitly scoped to its newly created seeded room. */
export async function deleteProbeRoom(ctx: MutationCtx, roomId: RoomId): Promise<void> {
  const room = await ctx.db.get(roomId);
  if (!room || room.provenance !== 'seeded') throw appError('internal');
  const outcome = await deleteRoomChildren(ctx, roomId, RESET_DOCUMENT_LIMIT - 1);
  // Throwing rolls back the entire probe rather than leaving partial cleanup.
  if (outcome.hitCap) throw appError('internal');
  await deleteMaintenanceRow(ctx, roomId);
}

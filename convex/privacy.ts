import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./lib/functions";
import { appError } from "./lib/errors";
import { REDACTABLE_TABLES, REDACTED, redactableField, type RedactableTable } from "./lib/privacyFields";
import { redactField, openRoomTx } from "./lib/db";
import { appendEvents } from "./model/events";

async function writeRedaction(ctx: MutationCtx, roomId: Id<"rooms">, table: RedactableTable, field: string): Promise<void> {
  const room = await ctx.db.get(roomId);
  if (!room) throw appError("input.invalid", { field: "rowId" });
  const tx = await openRoomTx(ctx, roomId, { allow: [room.status] });
  await appendEvents(tx, [{ payload: { type: 'pii_redacted', table, field: field as 'displayName' | 'invitedEmail' | 'title' | 'softFields.notes' | 'note' }, actor: { kind: 'system' } }]);
}

export const redact = internalMutation("privacy.redact")({
  args: {
    table: v.union(...REDACTABLE_TABLES.map((table) => v.literal(table))),
    rowId: v.string(),
    field: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!redactableField(args.table, args.field)) throw appError("input.invalid", { field: "field" });
    if (args.table === "users" && args.field === "displayName") {
      const id = ctx.db.normalizeId("users", args.rowId);
      if (id === null) throw appError("input.invalid", { field: "rowId" });
      const user = await ctx.db.get(id);
      if (!user) throw appError("input.invalid", { field: "rowId" });
      const memberships = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", id)).collect();
      await redactField(ctx, id, { displayName: REDACTED });
      for (const roomId of new Set(memberships.map(row => row.roomId))) await writeRedaction(ctx, roomId, "users", "displayName");
      return null;
    }
    if (args.table === "members" && args.field === "displayName") {
      const id = ctx.db.normalizeId("members", args.rowId);
      if (id === null) throw appError("input.invalid", { field: "rowId" });
      const row = await ctx.db.get(id);
      if (!row) throw appError("input.invalid", { field: "rowId" });
      await redactField(ctx, id, { displayName: REDACTED });
      await writeRedaction(ctx, row.roomId, "members", "displayName");
      return null;
    }
    if (args.table === "invites" && args.field === "invitedEmail") {
      const id = ctx.db.normalizeId("invites", args.rowId);
      if (id === null) throw appError("input.invalid", { field: "rowId" });
      const row = await ctx.db.get(id);
      if (!row) throw appError("input.invalid", { field: "rowId" });
      await redactField(ctx, id, { invitedEmail: REDACTED });
      await writeRedaction(ctx, row.roomId, "invites", "invitedEmail");
      return null;
    }
    if (args.table === "rooms" && args.field === "title") {
      const id = ctx.db.normalizeId("rooms", args.rowId);
      if (id === null) throw appError("input.invalid", { field: "rowId" });
      const row = await ctx.db.get(id);
      if (!row) throw appError("input.invalid", { field: "rowId" });
      await redactField(ctx, id, { title: REDACTED });
      await writeRedaction(ctx, row._id, "rooms", "title");
      return null;
    }
    if (args.table === "briefs" && args.field === "softFields.notes") {
      const id = ctx.db.normalizeId("briefs", args.rowId);
      if (id === null) throw appError("input.invalid", { field: "rowId" });
      const row = await ctx.db.get(id);
      if (!row) throw appError("input.invalid", { field: "rowId" });
      await redactField(ctx, id, { softFields: { ...row.softFields, notes: REDACTED } });
      await writeRedaction(ctx, row.roomId, "briefs", "softFields.notes");
      return null;
    }
    if (args.table === "approvals" && args.field === "note") {
      const id = ctx.db.normalizeId("approvals", args.rowId);
      if (id === null) throw appError("input.invalid", { field: "rowId" });
      const row = await ctx.db.get(id);
      if (!row) throw appError("input.invalid", { field: "rowId" });
      await redactField(ctx, id, { note: REDACTED });
      await writeRedaction(ctx, row.roomId, "approvals", "note");
      return null;
    }
    throw appError("input.invalid", { field: "field" });
  },
});

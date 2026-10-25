// Tiny, deliberately generic schema used only to exercise the helpers.
// Nothing here is a model of the real engine's tables.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  items: defineTable({
    ownerToken: v.string(),
    key: v.string(),
    title: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    processedAt: v.optional(v.number()),
  }).index("by_ownerToken_and_key", ["ownerToken", "key"]),

  itemMembers: defineTable({
    itemId: v.id("items"),
    memberToken: v.string(),
  }).index("by_itemId_and_memberToken", ["itemId", "memberToken"]),

  notes: defineTable({
    itemId: v.id("items"),
    authorToken: v.string(),
    body: v.string(),
    // Visible only to the note's author. Used to demonstrate forbidden-field checks.
    privateMemo: v.string(),
  }).index("by_itemId", ["itemId"]),
});

import { defineTable } from "convex/server";
import { v } from "convex/values";

// Engine-owned tables. Placeholder only: the real schema comes from design doc 03.
// Every engine table is keyed by roomId; scenario tables never redefine these.
export const engineTables = {
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkUserId: v.string(),
    displayName: v.string(),
  }).index("by_token", ["tokenIdentifier"]),
};

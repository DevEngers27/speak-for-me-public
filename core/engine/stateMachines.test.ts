import { describe, expect, test } from "vitest";
import {
  APPROVAL_DECISIONS,
  APPROVAL_DECISION_STATUSES,
  APPROVAL_DECISION_TERMINAL,
  APPROVAL_DECISION_TRANSITIONS,
  ATTEMPT_STATUSES,
  ATTEMPT_TERMINAL,
  ATTEMPT_TRANSITIONS,
  CATALOG_ITEM_STATUSES,
  CATALOG_ITEM_TERMINAL,
  CATALOG_ITEM_TRANSITIONS,
  EngineInvariantError,
  HUMAN_REQUEST_STATUSES,
  HUMAN_REQUEST_TERMINAL,
  HUMAN_REQUEST_TRANSITIONS,
  type Machine,
  PROPOSAL_STATUSES,
  PROPOSAL_TERMINAL,
  PROPOSAL_TRANSITIONS,
  ROOM_STATUSES,
  ROOM_TERMINAL,
  ROOM_TRANSITIONS,
  RUN_STATUSES,
  RUN_TERMINAL,
  RUN_TRANSITIONS,
  TASK_STATUSES,
  TASK_TERMINAL,
  TASK_TRANSITIONS,
  TRANSITIONS,
  TURN_STATUSES,
  TURN_TERMINAL,
  TURN_TRANSITIONS,
  assertTransition,
  canTransition,
} from "./stateMachines";

describe("core/engine/stateMachines", () => {
  test("stored status sets and terminal sets match canon §1.3", () => {
    expect(ROOM_STATUSES).toEqual(["setup", "open", "executed", "closed"]);
    expect([...ROOM_TERMINAL]).toEqual(["executed", "closed"]);

    expect(RUN_STATUSES).toEqual([
      "negotiating",
      "pending_approval",
      "needs_input",
      "executed",
      "superseded",
      "ended_no_agreement",
      "canceled",
    ]);
    expect([...RUN_TERMINAL]).toEqual([
      "executed",
      "superseded",
      "ended_no_agreement",
      "canceled",
    ]);

    expect(TURN_STATUSES).toEqual(["scheduled", "running", "completed", "failed", "stale"]);
    expect([...TURN_TERMINAL]).toEqual(["completed", "failed", "stale"]);

    expect(ATTEMPT_STATUSES).toEqual([
      "running",
      "completed",
      "invalid_output",
      "timeout",
      "error",
      "refused",
      "stale",
    ]);
    expect([...ATTEMPT_TERMINAL]).toEqual([
      "completed",
      "invalid_output",
      "timeout",
      "error",
      "refused",
      "stale",
    ]);

    expect(PROPOSAL_STATUSES).toEqual([
      "active",
      "executed",
      "superseded",
      "rejected",
      "stale",
    ]);
    expect([...PROPOSAL_TERMINAL]).toEqual(["executed", "superseded", "rejected"]);

    expect(APPROVAL_DECISION_STATUSES).toEqual(["approve", "reject", "withdraw"]);
    expect(APPROVAL_DECISIONS).toEqual(["approve", "reject", "withdraw"]);
    expect([...APPROVAL_DECISION_TERMINAL]).toEqual(["reject"]);

    expect(HUMAN_REQUEST_STATUSES).toEqual(["open", "answered", "expired", "superseded"]);
    expect([...HUMAN_REQUEST_TERMINAL]).toEqual(["answered", "expired", "superseded"]);

    expect(CATALOG_ITEM_STATUSES).toEqual(["draft", "confirmed", "retired"]);
    expect([...CATALOG_ITEM_TERMINAL]).toEqual(["retired"]);

    expect(TASK_STATUSES).toEqual(["open", "done"]);
    expect([...TASK_TERMINAL]).toEqual(["done"]);
  });

  test("excludes deprecated/derived statuses (INV-SM-09, canon §1.3)", () => {
    expect(RUN_STATUSES).not.toContain("paused");
    expect(RUN_STATUSES).not.toContain("failed");
    expect(RUN_STATUSES).not.toContain("cancelled");
    expect(PROPOSAL_STATUSES).not.toContain("endorsed");
    expect(PROPOSAL_STATUSES).not.toContain("approved");
    expect(PROPOSAL_STATUSES).not.toContain("blocked");
    expect(CATALOG_ITEM_STATUSES).not.toContain("withdrawn");
    expect(TURN_STATUSES).not.toContain("succeeded");
  });

  test("snapshot of every transition table against canon §1.3 and 04", () => {
    expect({
      room: ROOM_TRANSITIONS,
      run: RUN_TRANSITIONS,
      turn: TURN_TRANSITIONS,
      attempt: ATTEMPT_TRANSITIONS,
      proposal: PROPOSAL_TRANSITIONS,
      approvalDecision: APPROVAL_DECISION_TRANSITIONS,
      humanRequest: HUMAN_REQUEST_TRANSITIONS,
      catalogItem: CATALOG_ITEM_TRANSITIONS,
      task: TASK_TRANSITIONS,
    }).toEqual({
      room: {
        none: ["setup"],
        setup: ["open", "closed"],
        open: ["executed", "closed"],
        executed: [],
        closed: [],
      },
      run: {
        none: ["negotiating", "pending_approval", "needs_input"],
        negotiating: ["negotiating", "pending_approval", "needs_input", "superseded", "canceled"],
        pending_approval: ["executed", "negotiating", "needs_input", "superseded", "canceled"],
        needs_input: [
          "needs_input",
          "negotiating",
          "pending_approval",
          "superseded",
          "ended_no_agreement",
          "canceled",
        ],
        executed: [],
        superseded: [],
        ended_no_agreement: [],
        canceled: [],
      },
      turn: {
        none: ["scheduled"],
        scheduled: ["running", "failed", "stale"],
        running: ["completed", "failed", "stale"],
        completed: [],
        failed: [],
        stale: [],
      },
      attempt: {
        none: ["running"],
        running: ["completed", "invalid_output", "timeout", "error", "refused", "stale"],
        completed: [],
        invalid_output: [],
        timeout: [],
        error: [],
        refused: [],
        stale: [],
      },
      proposal: {
        none: ["active"],
        active: ["executed", "superseded", "rejected", "stale"],
        stale: ["active"],
        executed: [],
        superseded: [],
        rejected: [],
      },
      approvalDecision: {
        none: ["approve", "reject"],
        approve: ["approve", "reject", "withdraw"],
        withdraw: ["approve", "reject"],
        reject: [],
      },
      humanRequest: {
        none: ["open"],
        open: ["answered", "expired", "superseded"],
        answered: [],
        expired: [],
        superseded: [],
      },
      catalogItem: {
        none: ["draft", "confirmed"],
        draft: ["confirmed"],
        confirmed: ["retired"],
        retired: [],
      },
      task: {
        none: ["open"],
        open: ["done"],
        done: [],
      },
    });
  });

  test("terminal states have no outgoing edges and non-terminal states have at least one exit", () => {
    const specs: Array<{
      machine: Machine;
      statuses: readonly string[];
      terminal: ReadonlySet<string>;
      table: Readonly<Record<string, readonly string[]>>;
    }> = [
      { machine: "room", statuses: ROOM_STATUSES, terminal: ROOM_TERMINAL, table: ROOM_TRANSITIONS },
      { machine: "run", statuses: RUN_STATUSES, terminal: RUN_TERMINAL, table: RUN_TRANSITIONS },
      { machine: "turn", statuses: TURN_STATUSES, terminal: TURN_TERMINAL, table: TURN_TRANSITIONS },
      {
        machine: "attempt",
        statuses: ATTEMPT_STATUSES,
        terminal: ATTEMPT_TERMINAL,
        table: ATTEMPT_TRANSITIONS,
      },
      {
        machine: "proposal",
        statuses: PROPOSAL_STATUSES,
        terminal: PROPOSAL_TERMINAL,
        table: PROPOSAL_TRANSITIONS,
      },
      {
        machine: "approvalDecision",
        statuses: APPROVAL_DECISION_STATUSES,
        terminal: APPROVAL_DECISION_TERMINAL,
        table: APPROVAL_DECISION_TRANSITIONS,
      },
      {
        machine: "humanRequest",
        statuses: HUMAN_REQUEST_STATUSES,
        terminal: HUMAN_REQUEST_TERMINAL,
        table: HUMAN_REQUEST_TRANSITIONS,
      },
      {
        machine: "catalogItem",
        statuses: CATALOG_ITEM_STATUSES,
        terminal: CATALOG_ITEM_TERMINAL,
        table: CATALOG_ITEM_TRANSITIONS,
      },
      { machine: "task", statuses: TASK_STATUSES, terminal: TASK_TERMINAL, table: TASK_TRANSITIONS },
    ];

    for (const { machine, statuses, terminal, table } of specs) {
      expect((table.none ?? []).length, `${machine}.none must have initial targets`).toBeGreaterThan(0);
      for (const s of statuses) {
        const targets = table[s] ?? [];
        if (terminal.has(s)) {
          expect(targets, `${machine}.${s} is terminal and must have 0 outgoing edges`).toEqual([]);
        } else {
          expect(
            targets.length,
            `${machine}.${s} is non-terminal and must have >= 1 outgoing edge`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  test("assertTransition and canTransition validate all (from, to) pairs across every machine (SM-01)", () => {
    const machines = Object.keys(TRANSITIONS) as Machine[];
    for (const m of machines) {
      const table = TRANSITIONS[m] as Readonly<Record<string, readonly string[]>>;
      const fromStates = Object.keys(table);
      const toStates = fromStates.filter((k) => k !== "none");

      for (const from of fromStates) {
        const allowedTargets = table[from] ?? [];
        for (const to of toStates) {
          if (allowedTargets.includes(to)) {
            expect(canTransition(m, from as never, to as never)).toBe(true);
            expect(() => assertTransition(m, from as never, to as never)).not.toThrow();
          } else {
            expect(canTransition(m, from as never, to as never)).toBe(false);
            try {
              assertTransition(m, from as never, to as never);
              expect.unreachable(`Expected illegal transition ${m}: ${from} -> ${to} to throw`);
            } catch (err) {
              expect(err).toBeInstanceOf(EngineInvariantError);
              const inv = err as EngineInvariantError;
              expect(inv.code).toBe("state.illegal_transition");
              expect(inv.details).toEqual({ m, from, to });
            }
          }
        }
      }
    }
  });

  test("supports every numbered design transition row in 04 §4.2–4.9 including R4 and R19 self-loops (W0-3-r04)", () => {
    const designRows: ReadonlyArray<{
      id: string;
      machine: Machine;
      from: string;
      to: string;
    }> = [
      // Room (04 §4.2 M1–M5)
      { id: "M1", machine: "room", from: "none", to: "setup" },
      { id: "M2", machine: "room", from: "setup", to: "open" },
      { id: "M3", machine: "room", from: "open", to: "executed" },
      { id: "M4", machine: "room", from: "setup", to: "closed" },
      { id: "M5", machine: "room", from: "open", to: "closed" },

      // Run (04 §4.3.2 R1–R19)
      { id: "R1", machine: "run", from: "none", to: "negotiating" },
      { id: "R2", machine: "run", from: "none", to: "pending_approval" },
      { id: "R3", machine: "run", from: "none", to: "needs_input" },
      { id: "R4", machine: "run", from: "negotiating", to: "negotiating" },
      { id: "R5", machine: "run", from: "negotiating", to: "pending_approval" },
      { id: "R6", machine: "run", from: "negotiating", to: "needs_input" },
      { id: "R7", machine: "run", from: "negotiating", to: "superseded" },
      { id: "R8", machine: "run", from: "negotiating", to: "canceled" },
      { id: "R9", machine: "run", from: "pending_approval", to: "executed" },
      { id: "R10", machine: "run", from: "pending_approval", to: "negotiating" },
      { id: "R11", machine: "run", from: "pending_approval", to: "needs_input" },
      { id: "R12", machine: "run", from: "pending_approval", to: "superseded" },
      { id: "R13", machine: "run", from: "pending_approval", to: "canceled" },
      { id: "R14", machine: "run", from: "needs_input", to: "negotiating" },
      { id: "R15", machine: "run", from: "needs_input", to: "pending_approval" },
      { id: "R16", machine: "run", from: "needs_input", to: "superseded" },
      { id: "R17", machine: "run", from: "needs_input", to: "ended_no_agreement" },
      { id: "R18", machine: "run", from: "needs_input", to: "canceled" },
      { id: "R19", machine: "run", from: "needs_input", to: "needs_input" },

      // Turn (04 §4.4 U1–U6)
      { id: "U1", machine: "turn", from: "none", to: "scheduled" },
      { id: "U2", machine: "turn", from: "scheduled", to: "running" },
      { id: "U3", machine: "turn", from: "running", to: "completed" },
      { id: "U4", machine: "turn", from: "running", to: "failed" },
      { id: "U5", machine: "turn", from: "scheduled", to: "failed" },
      { id: "U6a", machine: "turn", from: "scheduled", to: "stale" },
      { id: "U6b", machine: "turn", from: "running", to: "stale" },

      // Attempt (04 §4.5.1 A1–A7)
      { id: "A1", machine: "attempt", from: "none", to: "running" },
      { id: "A2", machine: "attempt", from: "running", to: "completed" },
      { id: "A3", machine: "attempt", from: "running", to: "invalid_output" },
      { id: "A4", machine: "attempt", from: "running", to: "refused" },
      { id: "A5", machine: "attempt", from: "running", to: "timeout" },
      { id: "A6", machine: "attempt", from: "running", to: "error" },
      { id: "A7", machine: "attempt", from: "running", to: "stale" },

      // Proposal (04 §4.6 P1–P6)
      { id: "P1", machine: "proposal", from: "none", to: "active" },
      { id: "P2", machine: "proposal", from: "active", to: "superseded" },
      { id: "P3", machine: "proposal", from: "active", to: "rejected" },
      { id: "P4", machine: "proposal", from: "active", to: "stale" },
      { id: "P5", machine: "proposal", from: "stale", to: "active" },
      { id: "P6", machine: "proposal", from: "active", to: "executed" },

      // HumanRequest (04 §4.8.1 H1–H4)
      { id: "H1", machine: "humanRequest", from: "none", to: "open" },
      { id: "H2", machine: "humanRequest", from: "open", to: "answered" },
      { id: "H3", machine: "humanRequest", from: "open", to: "expired" },
      { id: "H4", machine: "humanRequest", from: "open", to: "superseded" },

      // CatalogItem (04 §4.9 C1–C3)
      { id: "C1", machine: "catalogItem", from: "none", to: "draft" },
      { id: "C2a", machine: "catalogItem", from: "draft", to: "confirmed" },
      { id: "C2b", machine: "catalogItem", from: "none", to: "confirmed" },
      { id: "C3", machine: "catalogItem", from: "confirmed", to: "retired" },

      // Task (04 §4.9 T1–T2)
      { id: "T1", machine: "task", from: "none", to: "open" },
      { id: "T2", machine: "task", from: "open", to: "done" },
    ];

    for (const row of designRows) {
      expect(
        canTransition(row.machine, row.from as never, row.to as never),
        `${row.id} (${row.machine}: ${row.from} -> ${row.to}) should be allowed`,
      ).toBe(true);
      expect(
        () => assertTransition(row.machine, row.from as never, row.to as never),
        `${row.id} (${row.machine}: ${row.from} -> ${row.to}) should not throw`,
      ).not.toThrow();
    }

    // Disallowed self-loop on pending_approval
    expect(canTransition("run", "pending_approval", "pending_approval")).toBe(false);
    expect(() => assertTransition("run", "pending_approval", "pending_approval")).toThrow(
      EngineInvariantError,
    );
  });
});

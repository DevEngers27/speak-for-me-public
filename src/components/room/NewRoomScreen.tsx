"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { countCodePoints, TEXT_LIMITS } from "@core/engine/ui";
import { useBackendStatus } from "@/components/providers";
import { api } from "@/lib/api";
import { parseUiError } from "@/lib/errors";
import { formatRole } from "@/lib/format";
import type { Role } from "@/lib/viewModels/types";

const ROLES: readonly Role[] = ["customer", "provider", "finance"];

export function NewRoomScreen({
  defaultTimeZone = "America/Los_Angeles",
  onCreateRoom,
}: {
  defaultTimeZone?: string;
  onCreateRoom?: (input: {
    title: string;
    scenarioKey: "scope_change";
    myRole: Role;
    timeZone: string;
  }) => Promise<{ roomId: string }>;
}) {
  const { live } = useBackendStatus();
  if (live && !onCreateRoom) {
    return (
      <LiveNewRoomScreen
        defaultTimeZone={defaultTimeZone}
      />
    );
  }
  return (
    <NewRoomFormView
      defaultTimeZone={defaultTimeZone}
      onCreate={
        onCreateRoom ??
        (async () => ({
          roomId: "room_new",
        }))
      }
    />
  );
}

function LiveNewRoomScreen({
  defaultTimeZone,
}: {
  defaultTimeZone: string;
}) {
  const router = useRouter();
  const createRoom = useMutation(api.rooms.create);
  return (
    <NewRoomFormView
      defaultTimeZone={defaultTimeZone}
      onCreate={(input) => createRoom(input)}
      onNavigate={(href) => router.push(href)}
    />
  );
}

export function NewRoomFormView({
  defaultTimeZone = "America/Los_Angeles",
  onCreate,
  onNavigate,
}: {
  defaultTimeZone?: string;
  onCreate: (input: {
    title: string;
    scenarioKey: "scope_change";
    myRole: Role;
    timeZone: string;
  }) => Promise<{ roomId: string }>;
  onNavigate?: (href: string) => void;
}) {
  const [title, setTitle] = useState("");
  const scenarioKey = "scope_change";
  const [creatorRole, setCreatorRole] = useState<Role>("customer");
  const [timeZone, setTimeZone] = useState(defaultTimeZone);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const titleLen = countCodePoints(title.trim());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || titleLen > TEXT_LIMITS.roomTitle) {
      setErrorText(
        `Enter a room title between 1 and ${TEXT_LIMITS.roomTitle} characters.`,
      );
      return;
    }
    setSubmitting(true);
    setErrorText(null);
    try {
      const res = await onCreate({
        title: trimmedTitle,
        scenarioKey,
        myRole: creatorRole,
        timeZone: timeZone.trim() || "America/Los_Angeles",
      });
      onNavigate?.(`/rooms/${res.roomId}/people`);
    } catch (err) {
      setErrorText(parseUiError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell" data-testid="new-room-page">
      <form className="panel stack" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Create Room</p>
          <h1 style={{ fontSize: "1.35rem", marginTop: "0.25rem" }}>
            Start a new negotiation room
          </h1>
          <p className="subtle">
            Choose your seat and invite the remaining participants once the room
            is created.
          </p>
        </div>

        <div className="stack">
          <label htmlFor="new-room-title">
            Room title ({titleLen}/{TEXT_LIMITS.roomTitle})
          </label>
          <input
            id="new-room-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Q4 Enterprise SSO & Audit Log Scope Change"
            data-testid="new-room-title-input"
          />
        </div>

        <div className="stack">
          <label htmlFor="new-room-scenario">Scenario template</label>
          <select
            id="new-room-scenario"
            defaultValue={scenarioKey}
            data-testid="new-room-scenario-select"
          >
            <option value="scope_change">Scope change (Customer · Provider · Finance)</option>
          </select>
        </div>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend className="kicker">Your role in this room</legend>
          <div className="row" style={{ marginTop: "0.35rem" }}>
            {ROLES.map((r) => (
              <label key={r} className="row">
                <input
                  type="radio"
                  name="creator-role"
                  value={r}
                  checked={creatorRole === r}
                  onChange={() => setCreatorRole(r)}
                  data-testid={`creator-role-${r}`}
                />
                <span>{formatRole(r)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="row">
          <div className="stack" style={{ flex: 1 }}>
            <label htmlFor="new-room-tz">Room time zone</label>
            <input
              id="new-room-tz"
              type="text"
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              data-testid="new-room-tz-input"
            />
          </div>
        </div>

        {errorText ? (
          <div
            className="stale-banner"
            role="alert"
            data-testid="new-room-error"
          >
            {errorText}
          </div>
        ) : null}

        <div className="row">
          <button
            type="submit"
            className="btn primary"
            data-testid="create-room-submit"
            disabled={submitting}
          >
            {submitting ? "Creating room…" : "Create room"}
          </button>
          <Link className="btn" href="/rooms">
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}

"use client";

import { useConvexAuth, useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useBackendStatus } from "@/components/providers";
import { api } from "@/lib/api";
import { formatErrorCode, parseUiError } from "@/lib/errors";

export function parseInviteFragmentToken(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1).trim() : hash.trim();
  if (!raw) return null;
  if (raw.includes("=")) {
    const params = new URLSearchParams(raw);
    const token = params.get("t") ?? params.get("token");
    return token && token.trim().length > 0 ? token.trim() : null;
  }
  return raw;
}

export function InviteLandingClient({
  initialHash,
  onAcceptToken,
}: {
  initialHash?: string;
  onAcceptToken?: (token: string) => Promise<{ roomId: string }>;
}) {
  const { live } = useBackendStatus();
  if (live && !onAcceptToken) {
    return <LiveInviteLanding initialHash={initialHash} />;
  }
  return (
    <InviteLandingView
      initialHash={initialHash}
      isAuthenticated={Boolean(onAcceptToken)}
      onAccept={
        onAcceptToken ??
        (async () => {
          throw { data: { code: "invite.invalid" } };
        })
      }
    />
  );
}

function LiveInviteLanding({ initialHash }: { initialHash?: string }) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const acceptMutation = useMutation(api.invites.accept);
  return (
    <InviteLandingView
      initialHash={initialHash}
      isAuthenticated={isAuthenticated}
      isLoading={isLoading}
      onAccept={(token) => acceptMutation({ invite: { by: "link", token } })}
      onNavigate={(href) => router.push(href)}
    />
  );
}

export function InviteLandingView({
  initialHash,
  isAuthenticated,
  isLoading = false,
  onAccept,
  onNavigate,
}: {
  initialHash?: string;
  isAuthenticated: boolean;
  isLoading?: boolean;
  onAccept: (token: string) => Promise<{ roomId: string }>;
  onNavigate?: (href: string) => void;
}) {
  const [token, setToken] = useState<string | null>(() => {
    if (initialHash !== undefined) return parseInviteFragmentToken(initialHash);
    if (typeof window !== "undefined") {
      return parseInviteFragmentToken(window.location.hash);
    }
    return null;
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (initialHash !== undefined || typeof window === "undefined") return;
    const onHashChange = () => {
      setToken(parseInviteFragmentToken(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [initialHash]);

  async function handleAccept() {
    if (!token) {
      setErrorText(formatErrorCode("invite.invalid").message);
      return;
    }
    setSubmitting(true);
    setErrorText(null);
    try {
      const res = await onAccept(token);
      onNavigate?.(`/rooms/${res.roomId}/brief`);
    } catch (err) {
      setErrorText(parseUiError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell" data-testid="invite-page">
      <div className="panel stack">
        <div>
          <p className="eyebrow">Single-use invitation</p>
          <h1 style={{ fontSize: "1.35rem", marginTop: "0.25rem" }}>
            Join negotiation room
          </h1>
          <p className="subtle" style={{ marginTop: "0.35rem" }}>
            Invitation tokens stay in the URL fragment (<code>#t=…</code>) and
            are never sent in HTTP request headers.
          </p>
        </div>

        {!token ? (
          <div
            className="stale-banner"
            role="alert"
            data-testid="invite-missing-token"
          >
            {formatErrorCode("invite.invalid").message} Ask the room creator for
            a fresh single-use link or check your email invitations in{" "}
            <Link href="/rooms">/rooms</Link>.
          </div>
        ) : (
          <div className="panel muted stack" data-testid="invite-token-ready">
            <div className="row-between">
              <strong>Invitation token detected in browser fragment</strong>
              <span className="pill">Single-use · 72h</span>
            </div>
            <p className="subtle">
              Accepting binds your account to the invited seat in this room.
              Each participant may hold at most one role per room.
            </p>
            {isLoading ? (
              <p className="subtle" data-testid="invite-auth-loading">
                Checking session…
              </p>
            ) : !isAuthenticated ? (
              <div className="row">
                <Link className="btn primary" href="/sign-in">
                  Sign in to accept invitation
                </Link>
              </div>
            ) : (
              <div className="row">
                <button
                  type="button"
                  className="btn primary"
                  data-testid="accept-invite-btn"
                  disabled={submitting}
                  onClick={handleAccept}
                >
                  {submitting ? "Accepting…" : "Accept invitation"}
                </button>
              </div>
            )}
          </div>
        )}

        {errorText ? (
          <div className="stale-banner" role="alert" data-testid="invite-error">
            {errorText}
          </div>
        ) : null}

        <div className="row">
          <Link className="btn" href="/rooms">
            Go to rooms
          </Link>
        </div>
      </div>
    </main>
  );
}

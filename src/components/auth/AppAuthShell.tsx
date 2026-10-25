"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/LiveAnnouncer";
import { useBackendStatus } from "@/components/providers";
import { api } from "@/lib/api";
import type { ViewerView } from "@/lib/viewModels/types";
import { parseUiError } from "@/lib/errors";

export interface AuthGateStateProps {
  readonly clerkLoaded: boolean;
  readonly clerkSignedIn: boolean;
  readonly convexLoading: boolean;
  readonly convexAuthenticated: boolean;
  readonly viewer: ViewerView | null | undefined;
  readonly provisioningError?: string | null;
  readonly onRetryProvision?: () => void;
  readonly children?: ReactNode;
}

/**
 * Pure view for the `(app)` authentication & user-provisioning gate (13 §13.2, W1-6-r08).
 * Guarantees:
 * - No `NotAvailable` flash before auth finishes loading (`13.2 no NotAvailable flash before auth`).
 * - Shows the session mismatch banner when Clerk is signed in but Convex rejects the token.
 * - Waits for `users.viewer` / `users.ensureViewer` before mounting any room query.
 */
export function AppAuthGateView({
  clerkLoaded,
  clerkSignedIn,
  convexLoading,
  convexAuthenticated,
  viewer,
  provisioningError = null,
  onRetryProvision,
  children,
}: AuthGateStateProps) {
  if (!clerkLoaded || convexLoading) {
    return (
      <div className="page-shell" data-testid="auth-loading-skeleton">
        <div className="panel muted">
          <p className="subtle">Loading authenticated workspace…</p>
        </div>
      </div>
    );
  }

  if (clerkSignedIn && !convexAuthenticated) {
    return (
      <div className="page-shell" data-testid="auth-mismatch-banner">
        <div className="stale-banner stack" role="alert">
          <strong>
            Signed in, but the backend did not accept your session. See{" "}
            <Link href="/setup">/setup</Link>.
          </strong>
          <p className="subtle">
            Verify that <code>CLERK_JWT_ISSUER_DOMAIN</code> in Convex matches
            your Clerk Frontend API domain on <Link href="/setup">/setup</Link>.
          </p>
        </div>
      </div>
    );
  }

  if (!convexAuthenticated) {
    return (
      <div className="page-shell" data-testid="auth-unauthenticated">
        <div className="panel stack">
          <p>Sign in to continue.</p>
          <div className="row">
            <Link className="btn primary" href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (provisioningError) {
    return (
      <div className="page-shell" data-testid="auth-provision-error">
        <div className="stale-banner stack" role="alert">
          <strong>{provisioningError}</strong>
          {onRetryProvision ? (
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={onRetryProvision}
                data-testid="retry-provision-btn"
              >
                Try again
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (viewer?.status !== "ready") {
    return (
      <div className="page-shell" data-testid="auth-provisioning-skeleton">
        <div className="panel muted">
          <p className="subtle">Preparing your account…</p>
        </div>
      </div>
    );
  }

  return <LiveAnnouncerProvider>{children}</LiveAnnouncerProvider>;
}

export function AppAuthShell({ children }: { children: ReactNode }) {
  const { live } = useBackendStatus();
  if (!live) {
    return <LiveAnnouncerProvider>{children}</LiveAnnouncerProvider>;
  }
  return <LiveAppAuthShell>{children}</LiveAppAuthShell>;
}

function LiveAppAuthShell({ children }: { children: ReactNode }) {
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn } = useAuth();
  const { isLoading: convexLoading, isAuthenticated: convexAuthenticated } =
    useConvexAuth();

  const viewer = useQuery(
    api.users.viewer,
    convexAuthenticated ? {} : "skip",
  );
  const ensureViewer = useMutation(api.users.ensureViewer);
  const provisioningRef = useRef(false);
  const [retryProvision, setRetryProvision] = useState(0);
  const [provisioningError, setProvisioningError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!convexAuthenticated || viewer?.status === "ready") {
      provisioningRef.current = false;
      return;
    }
    if (viewer?.status !== "unprovisioned" || provisioningRef.current) {
      return;
    }
    provisioningRef.current = true;
    ensureViewer({})
      .catch((err: unknown) => {
        provisioningRef.current = false;
        setProvisioningError(parseUiError(err).message);
      });
  }, [convexAuthenticated, viewer, ensureViewer, retryProvision]);

  return (
    <AppAuthGateView
      clerkLoaded={Boolean(clerkLoaded)}
      clerkSignedIn={Boolean(clerkSignedIn)}
      convexLoading={convexLoading}
      convexAuthenticated={convexAuthenticated}
      viewer={viewer}
      provisioningError={provisioningError}
      onRetryProvision={() => {
        setProvisioningError(null);
        provisioningRef.current = false;
        setRetryProvision((n) => n + 1);
      }}
    >
      {children}
    </AppAuthGateView>
  );
}

import Link from "next/link";
import { APP_NAME } from "@core/engine/ui";
import { getServiceConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

const REQUIRED_KEYS = [
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
] as const;

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ missing?: string }>;
}) {
  const { missing: redirectedBecause } = await searchParams;
  const config = getServiceConfig();
  const missing =
    config.mode === "unconfigured" ? new Set(config.missing) : new Set<string>();

  return (
    <main className="page-shell" data-testid="setup-page">
      <div className="panel stack">
        <div>
          <p className="eyebrow">Environment Diagnostic</p>
          <h1 style={{ fontSize: "1.35rem", marginTop: "0.25rem" }}>
            {APP_NAME} · Service Setup
          </h1>
        </div>
        {redirectedBecause ? (
          <div className="stale-banner" data-testid="setup-redirect-banner">
            Protected routes require authentication to be configured before
            they can be opened.
          </div>
        ) : null}
        <p className="subtle">
          Status:{" "}
          <strong data-testid="setup-mode">
            {config.mode === "configured" ? "Ready" : "Missing configuration"}
          </strong>
        </p>
        <ul className="check-list" data-testid="setup-checklist">
          {REQUIRED_KEYS.map((key) => {
            const isMissing = missing.has(key);
            return (
              <li
                key={key}
                className={isMissing ? "check-fail" : "check-ok"}
                data-testid={`setup-key-${key}`}
              >
                <code>{key}</code>:{" "}
                {isMissing
                  ? "missing"
                  : key === "CLERK_SECRET_KEY"
                    ? "set (server-only, never sent to the browser)"
                    : "set"}
              </li>
            );
          })}
        </ul>
        <div className="panel muted stack" data-testid="setup-issuer-diagnostic">
          <div className="row-between">
            <strong>Clerk JWT Issuer Diagnostic</strong>
            <span className="pill">Convex Auth</span>
          </div>
          <p className="subtle">
            Convex validates Clerk session tokens against{" "}
            <code>CLERK_JWT_ISSUER_DOMAIN</code> in the Convex environment.
          </p>
          <p className="subtle" data-testid="setup-clerk-host">
            Decoded Clerk Frontend API host:{" "}
            <code>
              {config.clerkFrontendApiHost
                ? `https://${config.clerkFrontendApiHost}`
                : "Unavailable (set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)"}
            </code>
          </p>
        </div>
        <div className="row">
          <Link className="btn" href="/">
            Back to home
          </Link>
          {config.mode === "configured" ? (
            <Link className="btn primary" href="/rooms">
              Go to rooms
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  );
}

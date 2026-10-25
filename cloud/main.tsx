import React, { type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignUp, UserButton, useAuth, useClerk } from "@clerk/react";
import { ConvexClientProvider } from "../src/components/providers";
import { AppAuthShell } from "../src/components/auth/AppAuthShell";
import { InboxScreen } from "../src/components/inbox/InboxScreen";
import { NewRoomScreen } from "../src/components/room/NewRoomScreen";
import { RoomFrame } from "../src/components/room/RoomFrame";
import { WorkbenchScreen, BriefRoute, ResultsRoute, TimelineRoute, PeopleRoute, ProposalRoute, RequestRoute } from "../src/components/room/RoomScreens";
import { InviteLandingClient } from "../src/components/invite/InviteLandingClient";
import HomePage from "../src/app/(public)/page";
import { usePathname } from "./navigation";
import Link from "./link";
import { rememberInviteFragment, restoreInviteFragment } from "./invite-return";
import { parseRoomRoute } from "./routes";
import "../src/app/globals.css";

// Public service identifiers only. Keys and all business decisions stay in Convex.
const convexUrl = "https://benevolent-jackal-41.convex.cloud";
const publishableKey = "pk_test_cGxlYXNpbmctZG9yeS01ODYxLmNsZXJrLmFjY291bnRzLmRldiQ";
class ErrorBoundary extends React.Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main className="page-shell"><section className="panel stack"><h1>Let’s reconnect.</h1><p>The workspace could not load. Reload to try again.</p><button className="btn primary" onClick={() => window.location.reload()}>Reload workspace</button><button className="btn" onClick={() => window.location.assign(new URL("/rooms", window.location.origin).href)}>Return to rooms</button></section></main> : this.props.children;
  }
}
function CloudInvite() {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const [error, setError] = React.useState(false);
  React.useState(() => restoreInviteFragment());
  if (!isLoaded) return <main className="page-shell">Checking session…</main>;
  if (isSignedIn) return <AppAuthShell><InviteLandingClient /></AppAuthShell>;
  return <main className="page-shell" data-testid="invite-page"><section className="panel stack"><p className="eyebrow">Private invitation</p><h1>Sign in to join this room</h1><p>Your invitation stays in this browser. Sign in, then review and accept your invitation.</p><button className="btn primary" onClick={() => {
    if (!rememberInviteFragment()) { setError(true); return; }
    void clerk.openSignIn({ forceRedirectUrl: "/invite", signUpForceRedirectUrl: "/invite" });
  }}>Sign in to continue</button>{error ? <p role="alert">Allow session storage in this browser, then try again. Keep your original invitation link.</p> : null}<Link href="/rooms">Return to rooms</Link></section></main>;
}
function Routes() {
  const path = usePathname();
  if (path === "/") return <HomePage />;
  if (path === "/sign-in" || path.startsWith("/sign-in/")) return <main className="page-shell"><SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/rooms" /></main>;
  if (path === "/sign-up" || path.startsWith("/sign-up/")) return <main className="page-shell"><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/rooms" /></main>;
  if (path === "/setup") return <main className="page-shell" data-testid="setup-page"><section className="panel stack"><p className="eyebrow">Connected services</p><h1>Your cloud workspace</h1><p>Clerk provides sign-in. Convex stores rooms and checks permissions. Three role-scoped Claude agents propose options; code validates constraints and people make the final decision.</p><p>Project examples are illustrative. Execution writes internal records; no payments or signatures are sent.</p><Link className="btn primary" href="/rooms">Open rooms</Link></section></main>;
  if (path === "/invite") return <CloudInvite />;
  let content: ReactNode;
  if (path === "/rooms") content = <InboxScreen />;
  else if (path === "/rooms/new") content = <NewRoomScreen />;
  else {
    const route = parseRoomRoute(path);
    if (!route) return <main className="page-shell"><h1>Page not found</h1><Link href="/rooms">Return to rooms</Link></main>;
    const { roomId, section, id } = route;
    const screen = section === "brief" ? <BriefRoute /> : section === "results" ? <ResultsRoute /> : section === "timeline" ? <TimelineRoute /> : section === "people" ? <PeopleRoute /> : section === "proposals" && id ? <ProposalRoute proposalId={id} /> : section === "requests" && id ? <RequestRoute requestId={id} /> : <WorkbenchScreen />;
    content = <ErrorBoundary key={path}><RoomFrame key={roomId} roomId={roomId}>{screen}</RoomFrame></ErrorBoundary>;
  }
  return <AppAuthShell><header className="cloud-account-bar"><Link href="/rooms">Speak for Me</Link><UserButton /></header><main className="rooms-layout">{content}</main></AppAuthShell>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><ErrorBoundary><ClerkProvider publishableKey={publishableKey} signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/" signInFallbackRedirectUrl="/rooms" signUpFallbackRedirectUrl="/rooms"><ConvexClientProvider convexUrl={convexUrl}><Routes /></ConvexClientProvider></ClerkProvider></ErrorBoundary></React.StrictMode>);

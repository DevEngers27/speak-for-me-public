import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { getServiceConfig } from "@/lib/config";

export default function SignInPage() {
  const config = getServiceConfig();
  return (
    <main className="page-shell" data-testid="sign-in-page">
      <div className="panel stack">
        <h1 style={{ fontSize: "1.25rem" }}>Sign in</h1>
        {config.mode === "configured" ? (
          <SignIn routing="path" path="/sign-in" fallbackRedirectUrl="/rooms" />
        ) : (
          <p className="subtle">
            Authentication is not configured yet. Visit{" "}
            <Link href="/setup">/setup</Link> to inspect required environment
            variables.
          </p>
        )}
      </div>
    </main>
  );
}

import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { getServiceConfig } from "@/lib/config";

export default function SignUpPage() {
  const config = getServiceConfig();
  return (
    <main className="page-shell" data-testid="sign-up-page">
      <div className="panel stack">
        <h1 style={{ fontSize: "1.25rem" }}>Create an account</h1>
        {config.mode === "configured" ? (
          <SignUp routing="path" path="/sign-up" fallbackRedirectUrl="/rooms" />
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

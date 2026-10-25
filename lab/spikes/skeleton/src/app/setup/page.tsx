import { getServiceConfig } from "@/lib/config";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ missing?: string }> }) {
  const { missing } = await searchParams;
  const config = getServiceConfig();
  return (
    <section>
      <h1>Setup</h1>
      {missing === "clerk" && <p role="alert">Sign-in is required for that page, but Clerk is not configured.</p>}
      <p>Status: {config.mode}</p>
      {config.mode === "unconfigured" && (
        <ul>
          {config.missing.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
      <p>Values are never displayed. See README for which variables belong to Next vs Convex.</p>
    </section>
  );
}

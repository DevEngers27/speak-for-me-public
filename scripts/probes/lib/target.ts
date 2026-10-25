import { resolveDeploymentTarget } from "../../lib/deployment-target.mjs";

export type ProbeEnv = Record<string, string | undefined>;

/** Refuse prod deployments and prod keys. The message never includes a key or its secret half. */
export function refuseProbeEnvironment(env: ProbeEnv): { message: string } | null {
  const deployment = env.CONVEX_DEPLOYMENT ?? "";
  const prefix = (env.CONVEX_DEPLOY_KEY ?? "").split("|")[0] ?? "";
  if (deployment.startsWith("prod:") || deployment === "prod" || prefix === "prod" || prefix.startsWith("prod:")) {
    return { message: "Refused: probe scripts cannot target a prod deployment." };
  }
  const resolution = resolveDeploymentTarget(env);
  if (!resolution.ok || resolution.target === undefined) return { message: "Refused: deployment selection is ambiguous or missing." };
  if (resolution.target.type === "prod") return { message: "Refused: probe scripts cannot target a prod deployment." };
  return null;
}

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CANARY_CUSTOMER, CANARY_PROVIDER, CANARY_FINANCE } from "../../core/scenarios/scope-change/fixtures/canaries.ts";

/** Run against a completed build, never silently skip a missing artifact. */
export function verifyBuildArtifacts(directory: string): number {
 const forbidden = ["__SFM_ENGINE_CANARY__", CANARY_CUSTOMER, CANARY_PROVIDER, CANARY_FINANCE, "512347", "481237", "sk_test_", "sk_live_", "sk-ant-", "ghp_", "github_pat_"];
 function walk(dir:string):string[] { return readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory() ? walk(path) : /\.(js|css|json|txt|map)$/.test(name) ? [path] : [];}); }
 const files=walk(directory);
 if(!files.length) throw new Error("Build privacy check requires nonempty browser artifacts. Build the app first.");
 for(const file of files) { if(file.endsWith(".map")) throw new Error(`Build privacy check failed in ${file}: source maps must not be published.`); const content=readFileSync(file,"utf8"); if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) throw new Error(`Build privacy check failed in ${file}: private key detected.`);for(const marker of forbidden) if(content.includes(marker)) throw new Error(`Build privacy check failed in ${file}: forbidden marker detected.`); }
 return files.length;
}

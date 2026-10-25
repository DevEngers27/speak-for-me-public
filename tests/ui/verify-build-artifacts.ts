import { verifyBuildArtifacts } from "./artifact-check.ts";
const directory=process.argv[2] || ".next/static";
const count=verifyBuildArtifacts(directory);
console.log(`AR-2: ${count} browser artifacts checked; no private fixture or secret markers.`);

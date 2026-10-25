import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyBuildArtifacts } from "./artifact-check";
const directories:string[]=[];
function fixture() { const dir=mkdtempSync(join(tmpdir(),"sfm-artifacts-"));directories.push(dir);return dir; }
afterEach(()=>{for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
it("AR-2 rejects missing and empty browser artifacts instead of treating an unbuilt app as safe",()=>{const dir=fixture();expect(()=>verifyBuildArtifacts(join(dir,"missing"))).toThrow();expect(()=>verifyBuildArtifacts(dir)).toThrow(/nonempty/);});
it("AR-2 checks nested production chunks and rejects private or secret marker leaks",()=>{const dir=fixture();mkdirSync(join(dir,"chunks"));writeFileSync(join(dir,"chunks","app.js"),'console.log("safe public terms")');expect(verifyBuildArtifacts(dir)).toBe(1);for(const marker of ["CANARY-CUS-2219","CANARY-PRV-5582","CANARY-FIN-7731","__SFM_ENGINE_CANARY__","512347","481237","sk_live_","sk_test_","sk-ant-test","ghp_test","github_pat_test"]){writeFileSync(join(dir,"chunks","app.js"),marker);expect(()=>verifyBuildArtifacts(dir)).toThrow(/forbidden/);}});

it("AR-2 rejects published source maps and PEM private keys",()=>{const dir=fixture();const file=join(dir,"app.js");writeFileSync(file,"safe");writeFileSync(join(dir,"app.js.map"),"{}");expect(()=>verifyBuildArtifacts(dir)).toThrow(/source maps/);rmSync(join(dir,"app.js.map"));for(const header of ["-----BEGIN PRIVATE KEY-----","-----BEGIN RSA PRIVATE KEY-----","-----BEGIN EC PRIVATE KEY-----","-----BEGIN OPENSSH PRIVATE KEY-----"]){writeFileSync(file,header);expect(()=>verifyBuildArtifacts(dir)).toThrow(/private key/);}});

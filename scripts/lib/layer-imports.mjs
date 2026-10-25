/**
 * Portable-layer import checks that the skeleton ESLint config does not cover:
 * bare Node builtins in core/engine and core/scenarios, and relative imports
 * that leave core/, convex/, and src/.
 */
import { builtinModules } from "node:module";
import path from "node:path";

const builtinNames = new Set();
for (const name of builtinModules) {
  builtinNames.add(name);
  builtinNames.add(name.startsWith("node:") ? name.slice(5) : `node:${name}`);
}

const LAYER_PREFIXES = ["core/", "convex/", "src/"];
const PORTABLE_PREFIXES = ["core/engine/", "core/scenarios/"];

export function importSpecifiers(code) {
  const specs = new Set();
  const patterns = [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      if (match[1]) specs.add(match[1]);
    }
  }
  return [...specs];
}

export function isNodeBuiltin(spec) {
  if (spec.startsWith("node:")) return true;
  const bare = spec.startsWith("node:") ? spec.slice(5) : spec;
  if (builtinNames.has(bare)) return true;
  const head = bare.split("/")[0] ?? bare;
  return builtinNames.has(head);
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

export function isPortableFile(filePath) {
  const posix = toPosix(filePath);
  return PORTABLE_PREFIXES.some((prefix) => posix === prefix.slice(0, -1) || posix.startsWith(prefix));
}

export function relativeTargetOutsideLayers(fromFile, spec) {
  if (!spec.startsWith(".")) return false;
  const posix = toPosix(fromFile);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(posix), spec));
  return !LAYER_PREFIXES.some((prefix) => resolved === prefix.slice(0, -1) || resolved.startsWith(prefix));
}

export function findLayerImportViolations(filePath, code) {
  const violations = [];
  for (const spec of importSpecifiers(code)) {
    if (isPortableFile(filePath) && isNodeBuiltin(spec)) {
      violations.push({ kind: "builtin", spec, filePath });
    }
    const testHelper = /\.test\.tsx?$/.test(filePath) && spec.startsWith(".") && /^tests\/(?:helpers|convex-helpers)\//.test(path.posix.normalize(path.posix.join(path.posix.dirname(toPosix(filePath)), spec)));
    if (!testHelper && relativeTargetOutsideLayers(filePath, spec)) {
      violations.push({ kind: "unclassified", spec, filePath });
    }
  }
  return violations;
}

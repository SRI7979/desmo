/**
 * Launch check: no server-only secret may reach a browser. Scans everything
 * a production build sends to clients (the .next/static bundle plus the
 * prerendered HTML and RSC payloads) for the literal values of every
 * server-only variable in .env.local and for secret-shaped patterns.
 * Prints only names and counts, never a value. Exits 1 on any finding.
 *
 *   npm run build && npx tsx scripts/audit-client-secrets.mts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
// Without .env.local (CI, a fresh container) only the key-shaped patterns are checked.
const envFile = (() => {
  try {
    return readFileSync(path.join(root, ".env.local"), "utf8");
  } catch {
    console.warn("No .env.local: checking key-shaped patterns only, not your configured server-only values.");
    return "";
  }
})();
const env = Object.fromEntries(
  envFile
    .split("\n")
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const serverOnly = Object.entries(env).filter(([name, value]) => !name.startsWith("NEXT_PUBLIC_") && value.length >= 8);
const publicVars = Object.entries(env).filter(([name, value]) => name.startsWith("NEXT_PUBLIC_") && value.length >= 8);

const patterns: [string, RegExp][] = [
  ["OpenAI key (sk-...)", /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/],
  ["Supabase secret key (sb_secret_...)", /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ["service_role JWT", /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/],
  ["Private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

function files(directory: string, keep: (file: string) => boolean): string[] {
  let found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found = found.concat(files(full, keep));
    else if (keep(full)) found.push(full);
  }
  return found;
}

const clientFiles = [
  ...files(path.join(root, ".next/static"), () => true),
  // Prerendered pages and their RSC payloads are served to browsers too.
  ...files(path.join(root, ".next/server/app"), (file) => /\.(html|rsc|body|meta)$/.test(file)),
];
let bytes = 0;
const findings: string[] = [];
const hits = new Map<string, number>();
for (const file of clientFiles) {
  const text = readFileSync(file, "latin1");
  bytes += text.length;
  for (const [name, value] of serverOnly) {
    if (text.includes(value)) hits.set(name, (hits.get(name) ?? 0) + 1);
  }
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) findings.push(`${label} in ${path.relative(root, file)}`);
  }
}

console.log(`Scanned ${clientFiles.length} client-served files (${(bytes / 1024 / 1024).toFixed(1)} MB): .next/static/** and .next/server/app/**/*.{html,rsc,body,meta}`);
console.log("\nServer-only values from .env.local (must be absent):");
for (const [name] of serverOnly) console.log(`  ${hits.has(name) ? "FOUND " : "absent"}  ${name}${hits.has(name) ? ` in ${hits.get(name)} file(s)` : ""}`);
console.log("\nSecret-shaped patterns (must be absent):");
for (const [label] of patterns) {
  const matched = findings.filter((finding) => finding.startsWith(label));
  console.log(`  ${matched.length ? "FOUND " : "absent"}  ${label}${matched.length ? `: ${matched.join(", ")}` : ""}`);
}
console.log("\nPublic by design (NEXT_PUBLIC_*, expected in the bundle when used):");
for (const [name, value] of publicVars) {
  const count = clientFiles.filter((file) => readFileSync(file, "latin1").includes(value)).length;
  console.log(`  ${count ? "present" : "absent "} ${name}${count ? ` (${count} file(s))` : ""}`);
}
const leaked = hits.size + findings.length;
console.log(leaked ? `\nLAUNCH BLOCKER: ${leaked} secret finding(s).` : "\nNo server-only secret is reachable from the client.");
process.exitCode = leaked ? 1 : 0;

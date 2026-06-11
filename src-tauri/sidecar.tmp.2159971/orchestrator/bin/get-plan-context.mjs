#!/usr/bin/env -S npx tsx

// ../../libs/papercusp/packages/orchestrator/bin/get-plan-context.ts
function parseArgs(argv) {
  const out = { slug: "", featureId: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = argv[i + 1];
    switch (a) {
      case "--slug":
        out.slug = next ?? "";
        i++;
        break;
      case "--feature-id":
        out.featureId = next ?? "";
        i++;
        break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!out.slug) throw new Error("--slug is required");
  if (!out.featureId) throw new Error("--feature-id is required");
  return out;
}
async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`get-plan-context: ${err.message}
`);
    process.exit(1);
  }
  const base = process.env.PAPERCUSP_OPERATOR_BASE ?? "http://localhost:3055";
  const url = `${base}/api/harness/${args.slug}/features/${args.featureId}/plan-context`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3e3) });
    if (!res.ok) {
      if (res.status === 404) process.exit(0);
      process.stderr.write(`get-plan-context: HTTP ${res.status} from operator
`);
      process.exit(0);
    }
    const data = await res.json();
    const section = data.section ?? "";
    if (section.trim()) {
      process.stdout.write(section);
      if (!section.endsWith("\n")) process.stdout.write("\n");
    }
  } catch {
    process.exit(0);
  }
}
main();

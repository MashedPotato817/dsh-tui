import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const required = [
  "AGENTS.md", "COLLABORATION.md", "CONTRIBUTING.md", "SECURITY.md",
  ".collab/templates/workstream.md", ".collab/templates/handoff.md",
  "docs/recovery-playbook.md", ".github/pull_request_template.md",
];
const missing = required.filter((path) => !existsSync(path));
if (missing.length) {
  console.error(`Missing governance files:\n${missing.join("\n")}`);
  process.exit(1);
}

for (const dir of [".collab/workstreams", ".collab/handoffs"]) {
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
    const text = readFileSync(`${dir}/${file}`, "utf8");
    if (/<(?:id|workstream-id)>/.test(text)) {
      console.error(`Unresolved template marker in ${dir}/${file}`);
      process.exit(1);
    }
  }
}

const branch = execFileSync("git", ["branch", "--show-current"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}).trim();
if (branch !== "main" && !/^(feat|fix|docs|chore|style|refactor|test|perf)\/[a-z0-9][a-z0-9-]*$/.test(branch)) {
  console.error(`Invalid branch name: ${branch}`);
  process.exit(1);
}

let staged = "";
try {
  staged = execFileSync("git", ["diff", "--cached", "--unified=0", "--no-color"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
} catch {}
if (/^\+\+\+ b\/(?:\.env(?:\.|$)|.*\.(?:pem|p12|pfx|key)$)/m.test(staged) ||
    /^\+(?!\+\+)\s*[^#\n]*(?:sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/m.test(staged)) {
  console.error("Staged diff appears to contain a forbidden credential file or secret.");
  process.exit(1);
}

console.log("Governance verification passed for dsh-tui.");

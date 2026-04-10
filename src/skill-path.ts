import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const SKILL_PARTS = ["skills", "slack", "SKILL.md"] as const;

/**
 * Resolve packaged `skills/slack/SKILL.md` for the bundled CLI (`dist/slack.js`),
 * dev runs (`src/skill-path.ts`), or tests.
 */
export function readPackagedSkillMarkdown(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, ...SKILL_PARTS),        // dist/skills/slack/SKILL.md (bundled)
    path.join(here, "..", ...SKILL_PARTS),  // skills/slack/SKILL.md (dev)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf8");
    }
  }
  throw new Error(
    "Could not find packaged skill SKILL.md. Reinstall @samkawsarani/slack-cli or run from a full checkout with skills/slack/SKILL.md.",
  );
}

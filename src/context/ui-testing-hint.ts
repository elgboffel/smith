import { resolveEvidenceStrategy, type ProjectEntry } from '../types.js';

/**
 * Build a `### UI Testing` context block for `ui-screenshot` repos.
 *
 * smith stays project-agnostic: the concrete build/start commands and the
 * browser-automation flow live in the repo's UI-testing skill, not in the
 * agent prompts. This helper surfaces the *pointers* — which skill to load and
 * the one-shot build/start commands from `projects.json` — so the scout (BEFORE
 * baseline) and verifier (AFTER) both know how to bring the app up without the
 * prompt hardcoding anything repo-specific.
 *
 * Returns `null` when the repo isn't `ui-screenshot` or has no concrete hint to
 * add, so callers can skip the section entirely.
 */
export function formatUiTestingHint(project?: ProjectEntry): string | null {
  if (!project) return null;
  if (resolveEvidenceStrategy(project) !== 'ui-screenshot') return null;

  const skill = project.uiTestingSkill;
  const build = project.commands?.['build-dev'] ?? project.commands?.build;
  const start = project.commands?.start;

  const lines = ['### UI Testing', ''];
  if (skill) {
    lines.push(
      `- **UI-testing skill**: \`${skill}\` — load it for the build/start commands, auth flow, and browser-automation steps.`,
    );
  }
  if (build) {
    lines.push(`- **Build (one-shot, no watcher)**: \`${build}\``);
  }
  if (start) {
    lines.push(`- **Start**: \`${start}\``);
  }

  // Nothing concrete beyond the heading — skip the section.
  if (lines.length === 2) return null;

  lines.push('');
  return lines.join('\n');
}

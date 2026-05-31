import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { normalizeRemoteUrl } from './repo-detector.js';
import type { ProjectEntry } from '../types.js';

export interface ResolvedTarget {
  project: ProjectEntry;
  workspaceDir: string;
  learningsKey: string;
}

export interface ResolveOptions {
  /** Directory containing per-repo JSON config files. */
  projectsDir: string;
  /** Override: bypass detection and select project by name. */
  project?: string;
  /** Injectable git remote URL (defaults to shelling out). */
  gitRemoteUrl?: string | null;
  /** Injectable git toplevel path (defaults to shelling out). */
  gitToplevel?: string | null;
}

/**
 * Resolve which project a working directory belongs to.
 *
 * Identity comes from git remote match (path match as fallback).
 * The workspace directory is `git rev-parse --show-toplevel` of cwd.
 */
export async function resolveTarget(cwd: string, opts: ResolveOptions): Promise<ResolvedTarget> {
  const projects = await loadProjectConfigs(opts.projectsDir);
  const toplevel = opts.gitToplevel ?? (await getGitToplevel(cwd));
  const workspaceDir = toplevel ?? cwd;

  // Explicit --project override
  if (opts.project) {
    const match = projects.find((p) => p.name === opts.project);
    if (!match) {
      throw projectNotFoundError(`Project "${opts.project}" not found.`, projects);
    }
    return { project: match, workspaceDir, learningsKey: match.learningsKey ?? match.name };
  }

  const remoteUrl = opts.gitRemoteUrl ?? (await getGitRemoteUrl(cwd));

  // Remote match
  if (remoteUrl) {
    const normalizedCwd = normalizeRemoteUrl(remoteUrl);
    for (const project of projects) {
      if (normalizeRemoteUrl(project.remote) === normalizedCwd) {
        return { project, workspaceDir, learningsKey: project.learningsKey ?? project.name };
      }
    }
  }

  // Path fallback
  const resolvedCwd = resolve(workspaceDir);
  for (const project of projects) {
    if (project.path) {
      const resolvedProjectPath = resolve(project.path);
      if (resolvedCwd === resolvedProjectPath || resolvedCwd.startsWith(resolvedProjectPath + '/')) {
        return { project, workspaceDir, learningsKey: project.learningsKey ?? project.name };
      }
    }
  }

  throw projectNotFoundError(`Project not found for cwd: ${cwd}`, projects);
}

function projectNotFoundError(message: string, projects: ProjectEntry[]): Error {
  const listing = projects.map((p) => `  ${p.name} (${p.remote})`).join('\n');
  return new Error(`${message}\nRegistered projects:\n${listing}`);
}

/** Load all project configs from individual JSON files in the projects directory. */
async function loadProjectConfigs(projectsDir: string): Promise<ProjectEntry[]> {
  const entries = await readdir(projectsDir);
  const projects: ProjectEntry[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const raw = await Bun.file(join(projectsDir, entry)).text();
    projects.push(JSON.parse(raw) as ProjectEntry);
  }
  return projects;
}

async function getGitRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', 'remote', 'get-url', 'origin'], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return code === 0 ? stdout.trim() || null : null;
  } catch {
    return null;
  }
}

async function getGitToplevel(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', 'rev-parse', '--show-toplevel'], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return code === 0 ? stdout.trim() || null : null;
  } catch {
    return null;
  }
}

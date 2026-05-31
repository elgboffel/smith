/**
 * LearningsStore — per-key learning storage.
 *
 * Layout: `<basePath>/<key>/_general.md` + `<basePath>/<key>/<area>.md`
 *
 * `_general.md` is always loaded. Domain files load only for requested areas.
 * Entries are markdown bullets: `- **<date>** — <text>`
 *
 * Auto-promotion: when 3+ entries in `_general` share an area prefix
 * (e.g. "middleware: ..."), they're moved to `<area>.md`.
 *
 * markPromoted: excludes an entry from read results (tracked in `.promoted`)
 * while keeping the original on disk for auditability.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LearningEntry {
  slug: string;
  text: string;
  source: string;
  promoted: boolean;
}

export interface LearningsResult {
  entries: LearningEntry[];
  sources: string[];
}

const GENERAL_FILE = '_general.md';
const PROMOTED_FILE = '.promoted';
const PROMOTION_THRESHOLD = 3;

export class LearningsStore {
  constructor(private readonly basePath: string) {}

  async read(key: string, areas?: string[]): Promise<LearningsResult> {
    const keyDir = join(this.basePath, key);
    const sources: string[] = [];
    const entries: LearningEntry[] = [];
    const promoted = this.loadPromoted(keyDir);

    // Collect files to load: _general always, plus requested areas
    const files: string[] = [GENERAL_FILE];
    if (areas) {
      for (const area of areas) files.push(`${area}.md`);
    }

    for (const file of files) {
      const filePath = join(keyDir, file);
      if (existsSync(filePath)) {
        sources.push(file);
        entries.push(...this.parseFile(filePath, file));
      }
    }

    const filtered = entries.filter((e) => !promoted.has(e.slug));
    return { entries: filtered, sources };
  }

  async markPromoted(key: string, slug: string): Promise<void> {
    const keyDir = join(this.basePath, key);
    mkdirSync(keyDir, { recursive: true });
    const promotedPath = join(keyDir, PROMOTED_FILE);
    appendFileSync(promotedPath, slug + '\n');
  }

  private loadPromoted(keyDir: string): Set<string> {
    const promotedPath = join(keyDir, PROMOTED_FILE);
    if (!existsSync(promotedPath)) return new Set();
    const content = readFileSync(promotedPath, 'utf-8');
    return new Set(content.split('\n').filter(Boolean));
  }

  async append(key: string, entry: string, area?: string): Promise<string> {
    const keyDir = join(this.basePath, key);
    mkdirSync(keyDir, { recursive: true });
    const targetFile = area ? `${area}.md` : GENERAL_FILE;
    const targetPath = join(keyDir, targetFile);
    const date = new Date().toISOString().slice(0, 10);
    const line = `- **${date}** \u2014 ${entry}\n`;
    appendFileSync(targetPath, line);

    // Auto-promote from _general when an area prefix accumulates enough entries
    if (!area) {
      this.maybePromote(keyDir, entry);
    }

    return this.extractSlug(line);
  }

  private maybePromote(keyDir: string, entry: string): void {
    // Detect area prefix pattern: "areaName: ..."
    const prefixMatch = entry.match(/^([a-z][a-z0-9_-]*):\s/i);
    if (!prefixMatch) return;

    const detectedArea = prefixMatch[1].toLowerCase();
    const generalPath = join(keyDir, GENERAL_FILE);
    if (!existsSync(generalPath)) return;

    const content = readFileSync(generalPath, 'utf-8');
    const lines = content.split('\n');
    const areaPattern = new RegExp(`\\u2014 ${detectedArea}:`, 'i');
    const matchingLines = lines.filter((l) => l.startsWith('- ') && areaPattern.test(l));

    if (matchingLines.length >= PROMOTION_THRESHOLD) {
      // Move matching entries to domain file
      const domainPath = join(keyDir, `${detectedArea}.md`);
      const toPromote = matchingLines.join('\n') + '\n';
      appendFileSync(domainPath, toPromote);

      // Remove from _general
      const remaining = lines.filter((l) => !matchingLines.includes(l)).join('\n');
      writeFileSync(generalPath, remaining);
    }
  }

  private parseFile(filePath: string, source: string): LearningEntry[] {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.startsWith('- '));
    return lines.map((line) => {
      const slug = this.extractSlug(line);
      return { slug, text: line.slice(2), source, promoted: false };
    });
  }

  private extractSlug(line: string): string {
    // Extract slug from format: `- **date** — slug: text`
    const match = line.match(/—\s*([^:]+):/);
    if (match) return match[1].trim().toLowerCase().replace(/\s+/g, '-');
    // Fallback: hash from content
    const content = line.slice(2).trim();
    return content
      .slice(0, 40)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+$/, '');
  }
}

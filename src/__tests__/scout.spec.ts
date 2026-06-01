import { describe, it, expect } from 'bun:test';
import {
  parseScoutFindings,
  ScoutFindingsValidationError,
  synthesizeForImplementer,
  synthesizeLocationForVerifier,
  validateScoutFindings,
} from '../scout/findings.js';
import type { ScoutFindings } from '../types.js';

function makeFindings(overrides: Partial<ScoutFindings> = {}): ScoutFindings {
  return {
    relevantFiles: [
      { path: 'src/dag/builder.ts', reason: 'wires phases into the graph' },
      { path: 'src/phases/verify.ts', reason: 'mirror its read-only phase pattern' },
    ],
    patterns: [
      {
        name: 'phase-dispatch',
        file: 'src/phases/verify.ts',
        description: 'phases return PhaseOutput with nextPhase + outcome',
      },
    ],
    constraints: ['No new runtime dependencies without owner approval'],
    suggestedApproach: 'Mirror verifier.md — read-only agent + structured AGENT_RESULT.',
    ...overrides,
  };
}

describe('validateScoutFindings', () => {
  it('accepts a well-formed payload', () => {
    const findings = makeFindings();
    expect(validateScoutFindings(findings)).toEqual(findings);
  });

  it('accepts findings without optional fields', () => {
    const minimal: ScoutFindings = {
      relevantFiles: [],
      patterns: [],
      constraints: [],
    };
    const out = validateScoutFindings(minimal);
    expect(out).toEqual(minimal);
    expect(out.suggestedApproach).toBeUndefined();
  });

  it('rejects null or array top-level values', () => {
    expect(() => validateScoutFindings(null)).toThrow(ScoutFindingsValidationError);
    expect(() => validateScoutFindings([])).toThrow(ScoutFindingsValidationError);
    expect(() => validateScoutFindings('hello')).toThrow(ScoutFindingsValidationError);
  });

  it('rejects missing required arrays', () => {
    expect(() => validateScoutFindings({ patterns: [], constraints: [] })).toThrow(/relevantFiles/);
    expect(() => validateScoutFindings({ relevantFiles: [], constraints: [] })).toThrow(/patterns/);
    expect(() => validateScoutFindings({ relevantFiles: [], patterns: [] })).toThrow(/constraints/);
  });

  it('rejects malformed relevantFiles entries', () => {
    const bad = { relevantFiles: [{ path: 'src/a.ts' }], patterns: [], constraints: [] };
    expect(() => validateScoutFindings(bad)).toThrow(/relevantFiles\[0\]\.reason/);
  });

  it('rejects malformed patterns entries', () => {
    const bad = {
      relevantFiles: [],
      patterns: [{ name: 'x', file: 'src/a.ts' }],
      constraints: [],
    };
    expect(() => validateScoutFindings(bad)).toThrow(/patterns\[0\]\.description/);
  });

  it('rejects non-string constraints', () => {
    const bad = { relevantFiles: [], patterns: [], constraints: ['ok', 42] };
    expect(() => validateScoutFindings(bad)).toThrow(/constraints\[1\]/);
  });

  it('accepts an optional location handoff', () => {
    const withLocation = makeFindings({
      location: { url: 'http://localhost:9998/back-office/orgs/org_123', steps: ['expand the row', 'open the panel'] },
    });
    const out = validateScoutFindings(withLocation);
    expect(out.location).toEqual({
      url: 'http://localhost:9998/back-office/orgs/org_123',
      steps: ['expand the row', 'open the panel'],
    });
  });

  it('accepts a location with no steps', () => {
    const out = validateScoutFindings(makeFindings({ location: { url: 'http://x', steps: [] } }));
    expect(out.location).toEqual({ url: 'http://x', steps: [] });
  });

  it('rejects a malformed location (missing url)', () => {
    const bad = { relevantFiles: [], patterns: [], constraints: [], location: { steps: [] } };
    expect(() => validateScoutFindings(bad)).toThrow(/location\.url/);
  });

  it('rejects a location with non-string steps', () => {
    const bad = { relevantFiles: [], patterns: [], constraints: [], location: { url: 'http://x', steps: [1] } };
    expect(() => validateScoutFindings(bad)).toThrow(/steps\[0\]/);
  });

  it('ignores unknown top-level fields', () => {
    const withExtras = { ...makeFindings(), unexpected: 'value', another: [1, 2, 3] };
    const out = validateScoutFindings(withExtras);
    expect((out as unknown as Record<string, unknown>).unexpected).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).another).toBeUndefined();
  });
});

describe('parseScoutFindings', () => {
  it('returns null on invalid input (graceful degradation)', () => {
    expect(parseScoutFindings(null)).toBeNull();
    expect(parseScoutFindings(undefined)).toBeNull();
    expect(parseScoutFindings({ relevantFiles: 'oops' })).toBeNull();
  });

  it('returns validated findings on valid input', () => {
    const findings = makeFindings();
    expect(parseScoutFindings(findings)).toEqual(findings);
  });
});

describe('synthesizeLocationForVerifier', () => {
  it('returns null when there is no location', () => {
    expect(synthesizeLocationForVerifier(null)).toBeNull();
    expect(synthesizeLocationForVerifier(makeFindings())).toBeNull();
  });

  it('renders the captured screen and nav steps', () => {
    const out = synthesizeLocationForVerifier(
      makeFindings({ location: { url: 'http://localhost:9998/orgs/org_1', steps: ['expand row', 'open panel'] } }),
    );
    expect(out).toContain('## Scout Baseline (BEFORE already captured)');
    expect(out).toContain('http://localhost:9998/orgs/org_1');
    expect(out).toContain('expand row');
    expect(out).toContain('open panel');
  });

  it('omits the nav-steps list when there are no steps', () => {
    const out = synthesizeLocationForVerifier(makeFindings({ location: { url: 'http://x', steps: [] } }));
    expect(out).toContain('http://x');
    expect(out).not.toContain('Navigation steps');
  });
});

describe('synthesizeForImplementer', () => {
  it('produces a "no findings" message when given null', () => {
    const out = synthesizeForImplementer(null);
    expect(out).toContain('## Scout Findings');
    expect(out).toContain('No scout findings available');
  });

  it('produces a "no findings" message when given an empty-but-valid findings object', () => {
    const empty: ScoutFindings = { relevantFiles: [], patterns: [], constraints: [] };
    const out = synthesizeForImplementer(empty);
    expect(out).toContain('## Scout Findings');
    expect(out).toContain('No scout findings');
  });

  it('renders all sections when every field is populated', () => {
    const out = synthesizeForImplementer(makeFindings());
    expect(out).toContain('## Scout Findings');
    expect(out).toContain('### Relevant Files');
    expect(out).toContain('src/dag/builder.ts');
    expect(out).toContain('wires phases into the graph');
    expect(out).toContain('### Patterns to Follow');
    expect(out).toContain('phase-dispatch');
    expect(out).toContain('### Constraints');
    expect(out).toContain('No new runtime dependencies');
    expect(out).toContain('### Suggested Approach');
    expect(out).toContain('Mirror verifier.md');
  });

  it('omits sections that have no entries', () => {
    const partial = makeFindings({
      patterns: [],
      constraints: [],
      suggestedApproach: undefined,
    });
    const out = synthesizeForImplementer(partial);
    expect(out).toContain('### Relevant Files');
    expect(out).not.toContain('### Patterns to Follow');
    expect(out).not.toContain('### Constraints');
    expect(out).not.toContain('### Suggested Approach');
  });

  it('omits suggestedApproach when it is blank whitespace', () => {
    const partial = makeFindings({ suggestedApproach: '   \n  ' });
    const out = synthesizeForImplementer(partial);
    expect(out).not.toContain('### Suggested Approach');
  });

  it('escapes file paths in code fences for legibility', () => {
    const findings = makeFindings({
      relevantFiles: [{ path: 'src/a.ts', reason: 'because' }],
    });
    const out = synthesizeForImplementer(findings);
    expect(out).toContain('`src/a.ts`');
  });

});

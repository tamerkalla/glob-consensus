import { describe, expect, it } from 'vitest';
import { consensus, ENGINES, type EngineName } from '../src/index.js';

describe('throwing behaviour, exhaustively', () => {
  it('TypeError for a non string pattern', () => {
    expect(() => consensus(7 as unknown as string)).toThrow(TypeError);
  });

  it('RangeError for an empty pattern', () => {
    expect(() => consensus('')).toThrow(RangeError);
  });

  it('TypeError when paths is not an array', () => {
    expect(() => consensus('*', 'a' as unknown as string[])).toThrow(TypeError);
  });

  it('TypeError when paths holds a non string', () => {
    expect(() => consensus('*', [1 as unknown as string])).toThrow(TypeError);
  });

  it('RangeError for an absolute path', () => {
    expect(() => consensus('*', ['/etc/passwd'])).toThrow(RangeError);
  });

  it('RangeError for a path with a parent segment', () => {
    expect(() => consensus('*', ['../outside'])).toThrow(RangeError);
    expect(() => consensus('*', ['a/../../outside'])).toThrow(RangeError);
  });

  it('does not throw for an exotic but legal pattern', () => {
    expect(() => consensus('!(*.test).@(ts|tsx)', ['a.ts'])).not.toThrow();
  });
});

describe('report shape', () => {
  it('always reports every engine, in the ENGINES order', () => {
    const r = consensus('*', ['a.ts']);
    expect(r.engines.map((e) => e.engine)).toEqual([...ENGINES]);
  });

  it('ENGINES is sorted and frozen', () => {
    expect([...ENGINES]).toEqual([...ENGINES].sort());
    expect(Object.isFrozen(ENGINES)).toBe(true);
  });

  it('with no paths, reports acceptance and empty verdicts', () => {
    const r = consensus('src/**');
    expect(r.paths).toEqual([]);
    expect(r.distinctVerdictCounts).toEqual([]);
    for (const e of r.engines) expect(e.verdicts).toEqual([]);
    // The refusal is still visible without any path to test against, which is
    // the whole reason availability is a field rather than something inferred
    // from the verdicts.
    expect(r.rejectedBy).toEqual(['typescript']);
  });

  it('a refusing engine reports a reason and rejects every path', () => {
    const r = consensus('src/**', ['a.ts', 'b.ts']);
    const t = r.engines.find((e) => e.engine === 'typescript')!;
    expect(t.available).toBe(true);
    expect(t.accepts).toBe(false);
    expect(t.reason).toBeTruthy();
    expect(t.verdicts).toEqual(['rejected', 'rejected']);
  });

  it('unanimous is true only when everything agreed', () => {
    expect(consensus('**/*.test.ts', ['a.test.ts']).unanimous).toBe(true);
    expect(consensus('src/**', ['src/a.ts']).unanimous).toBe(false);
  });
});

describe('rejected, no-match and unavailable are three distinct states', () => {
  it('distinguishes them without merging any pair', () => {
    const rejected = consensus('src/**', ['src/a.ts'])
      .engines.find((e) => e.engine === 'typescript')!;
    const noMatch = consensus('*.log', ['src/a.ts'])
      .engines.find((e) => e.engine === 'minimatch')!;
    expect(rejected.verdicts[0]).toBe('rejected');
    expect(noMatch.verdicts[0]).toBe('no-match');
    expect(rejected.verdicts[0]).not.toBe(noMatch.verdicts[0]);
  });

  it('an engine that cannot be consulted reports unavailable, not no-match', () => {
    // Force the git engine unavailable by emptying PATH for one call. Without
    // this the unavailable branch is never exercised on a machine that has git,
    // and a state nothing ever produces is a state nothing has tested.
    const realPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const r = consensus('*.log', ['a.log']);
      const git = r.engines.find((e) => e.engine === 'git')!;
      expect(git.available).toBe(false);
      expect(git.verdicts).toEqual(['unavailable']);
      expect(git.reason).toContain('git');
      // An unavailable engine is excluded from the consensus rather than
      // counted as a dissenting voice.
      expect(r.acceptedBy).not.toContain('git' as EngineName);
      expect(r.rejectedBy).not.toContain('git' as EngineName);
    } finally {
      process.env.PATH = realPath;
    }
  });
});

describe('purity and determinism', () => {
  it('does not mutate the paths array it was given', () => {
    const paths = ['a.ts', 'b.ts'];
    const copy = [...paths];
    consensus('*', paths);
    expect(paths).toEqual(copy);
  });

  it('returns a fresh object each call', () => {
    const a = consensus('*', ['a.ts']);
    const b = consensus('*', ['a.ts']);
    expect(a).not.toBe(b);
    expect(a.engines).not.toBe(b.engines);
  });

  it('two calls with equal arguments return deeply equal reports', () => {
    expect(consensus('**/*.{ts,tsx}', ['src/a.ts', 'a.log'])).toEqual(
      consensus('**/*.{ts,tsx}', ['src/a.ts', 'a.log'])
    );
  });

  it('reads no clock: the report carries no timestamp shaped value', () => {
    const json = JSON.stringify(consensus('*', ['a.ts']));
    expect(json).not.toMatch(/\d{4}-\d\d-\d\dT/);
  });
});

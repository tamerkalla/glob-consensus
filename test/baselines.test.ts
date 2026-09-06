// Section 2 of the build specification, asserted as exact integers.
//
// Every one of these is a count over the explicit corpus in corpus.ts, so an
// exact assertion is the honest kind. If an engine changes its mind in a future
// version, one of these fails loudly, which is the point: the numbers in the
// README are claims about named versions and they should not be able to rot
// quietly.

import { describe, expect, it } from 'vitest';
import { consensus, ENGINES } from '../src/index.js';
import { PATHS, PATTERNS } from './corpus.js';

const reports = PATTERNS.map((p) => consensus(p, [...PATHS]));

const refusedSomewhere = PATTERNS.filter((_, i) => reports[i]!.rejectedBy.length > 0);
const unanimousPatterns = PATTERNS.filter((_, i) => reports[i]!.unanimous);

describe('section 2 baselines', () => {
  it('B1: compares six engines', () => {
    expect(ENGINES.length).toBe(6);
    for (const r of reports) expect(r.engines.length).toBe(6);
  });

  it('B2: twenty five patterns', () => {
    expect(PATTERNS.length).toBe(25);
  });

  it('B3: twenty paths', () => {
    expect(PATHS.length).toBe(20);
  });

  it('B4: nineteen patterns are not read the same way by all six', () => {
    const notUnanimous = reports.filter((r) => !r.unanimous).length;
    expect(notUnanimous).toBe(19);
  });

  it('B5: five patterns are refused outright by at least one engine', () => {
    expect(refusedSomewhere.length).toBe(5);
    expect(new Set(refusedSomewhere)).toEqual(
      new Set(['src/**', '**/node_modules/**', '**', '**/__tests__/**', 'packages/*/src/**'])
    );
    // Every one of them is refused by typescript and accepted by the other five.
    for (const pattern of refusedSomewhere) {
      const r = reports[PATTERNS.indexOf(pattern)]!;
      expect(r.rejectedBy).toEqual(['typescript']);
      expect(r.acceptedBy.length).toBe(5);
    }
  });

  it('B6 and B7: 48 of the 400 pairs from universally accepted patterns differ', () => {
    let pairs = 0;
    let differing = 0;
    for (const r of reports) {
      if (r.rejectedBy.length > 0) continue;
      for (const n of r.distinctVerdictCounts) {
        pairs += 1;
        if (n > 1) differing += 1;
      }
    }
    expect(pairs).toBe(400);
    expect(differing).toBe(48);
  });

  it('B8: six patterns are the clean floor and report full agreement', () => {
    expect(unanimousPatterns.length).toBe(6);
    expect(new Set(unanimousPatterns)).toEqual(
      new Set([
        '**/*.test.ts',
        'src/*.ts',
        'test/**/*.spec.js',
        'build/**/*',
        '*.min.js',
        '**/*.d.ts',
      ])
    );
  });

  it('the corpus is not vacuous: every engine matched something somewhere', () => {
    for (const name of ENGINES) {
      const everMatched = reports.some((r) =>
        r.engines.find((e) => e.engine === name)!.verdicts.includes('match')
      );
      expect(everMatched, `${name} never matched anything`).toBe(true);
    }
  });
});

describe('the headline pair', () => {
  const report = consensus('src/**', ['src/.hidden/file.ts']);

  it('yields exactly three distinct verdicts', () => {
    expect(report.distinctVerdictCounts).toEqual([3]);
  });

  it('names each engine verdict', () => {
    const by = (n: string) => report.engines.find((e) => e.engine === n)!;
    expect(by('git').verdicts[0]).toBe('match');
    expect(by('micromatch').verdicts[0]).toBe('no-match');
    expect(by('minimatch').verdicts[0]).toBe('no-match');
    expect(by('node').verdicts[0]).toBe('no-match');
    expect(by('picomatch').verdicts[0]).toBe('no-match');
    expect(by('typescript').verdicts[0]).toBe('rejected');
    expect(by('typescript').accepts).toBe(false);
    expect(by('typescript').reason).toContain('recursive directory wildcard');
  });
});

// Every code example in every shipped document is executed here and its output
// compared to what the document claims. A README that drifts from the package
// is the most expensive kind of wrong, because npm serves it from the published
// tarball and a later edit to main never reaches the package page.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..');
const README = fs.readFileSync(nodePath.join(root, 'README.md'), 'utf8');
const VERIFY = fs.readFileSync(nodePath.join(root, 'VERIFY.md'), 'utf8');

const DEMO_BLOCK = `$ npx glob-consensus 'src/**' src/.hidden/file.ts

src/** vs src/.hidden/file.ts

  git          match
  micromatch   no match
  minimatch    no match
  node         no match
  picomatch    no match
  typescript   rejected: cannot end in a recursive directory wildcard

3 different answers for one pattern and one path.`;

const BADGE_ROW = `[![build](https://github.com/tamerkalla/glob-consensus/actions/workflows/release.yml/badge.svg)](https://github.com/tamerkalla/glob-consensus/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/glob-consensus.svg)](https://www.npmjs.com/package/glob-consensus)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![provenance](https://img.shields.io/badge/provenance-attested-brightgreen.svg)](https://www.npmjs.com/package/glob-consensus)`;

// spawnSync rather than execFileSync, and the status read directly. The CLI
// exits 1 when the engines disagreed, which is the finding rather than a
// failure, and a helper that throws on a non-zero exit cannot express that.
function runCli(args: string[]): { stdout: string; status: number } {
  const res = spawnSync(
    process.execPath,
    [nodePath.join(root, 'dist', 'cli.js'), ...args],
    { encoding: 'utf8', cwd: root }
  );
  return { stdout: res.stdout ?? '', status: res.status ?? -1 };
}

describe('README structure', () => {
  it('carries the demo block character for character', () => {
    expect(README).toContain(DEMO_BLOCK);
  });

  it('carries the four badge row character for character', () => {
    expect(README).toContain(BADGE_ROW);
  });

  it('puts the badge row after the opening hook and before the demo', () => {
    const hook = README.indexOf('This prints all six answers side by side.');
    const badges = README.indexOf(BADGE_ROW);
    const demo = README.indexOf(DEMO_BLOCK);
    expect(hook).toBeGreaterThan(-1);
    expect(badges).toBeGreaterThan(hook);
    expect(demo).toBeGreaterThan(badges);
  });

  it('carries the cross link to the adjacent package', () => {
    expect(README).toContain('host-consensus');
    expect(README).toContain('https://www.npmjs.com/package/host-consensus');
  });
});

describe('the shipped documents are executable and correct', () => {
  it('the demo command produces exactly the block the README shows', () => {
    const { stdout, status } = runCli(['src/**', 'src/.hidden/file.ts']);
    const claimed = DEMO_BLOCK.split('\n').slice(1).join('\n').trimStart();
    expect(stdout.trimEnd()).toBe(claimed.trimEnd());
    // Documented behaviour: 1 means the engines disagreed, which they did.
    expect(status).toBe(1);
  });

  it('exits 0 when every engine agrees', () => {
    const { status } = runCli(['**/*.test.ts', 'a.test.ts']);
    expect(status).toBe(0);
  });

  it('the README API example prints what the README says it prints', async () => {
    const { consensus } = await import('../src/index.js');
    const report = consensus('**/*.{ts,tsx}', ['src/a.ts', 'a.log']);
    const printed = [
      String(report.unanimous),
      JSON.stringify(report.rejectedBy),
      JSON.stringify(report.distinctVerdictCounts),
    ];
    expect(printed[0]).toBe('false');
    expect(printed[1]).toBe('[]');
    expect(printed[2]).toBe('[2,1]');
    // The README renders these the way node's console does.
    expect(README).toContain('false\n[]\n[ 2, 1 ]');
  });

  it('the README counts match what the package actually reports', async () => {
    const { consensus } = await import('../src/index.js');
    const { PATHS, PATTERNS } = await import('./corpus.js');
    const reports = PATTERNS.map((p) => consensus(p, [...PATHS]));
    const differ = reports.filter((r) => !r.unanimous).length;
    const agree = reports.filter((r) => r.unanimous).length;
    const refused = reports.filter((r) => r.rejectedBy.length > 0).length;
    expect(README).toContain(`**${differ} of the ${PATTERNS.length} patterns**`);
    expect(README).toContain(`**${refused} of them** are refused outright`);
    expect(README).toContain(`**${agree} patterns** are read identically`);
  });

  it('VERIFY.md shows the same expected demo output as the README', () => {
    const body = DEMO_BLOCK.split('\n').slice(1).join('\n').trimStart();
    expect(VERIFY).toContain(body.trimEnd());
  });

  it('the VERIFY.md counting script prints exactly what VERIFY.md claims', async () => {
    const { consensus } = await import('../src/index.js');
    const { PATHS, PATTERNS } = await import('./corpus.js');
    const reports = PATTERNS.map((p) => consensus(p, [...PATHS]));
    const out = [
      `patterns ${PATTERNS.length}`,
      `agree ${reports.filter((r) => r.unanimous).length}`,
      `differ ${reports.filter((r) => !r.unanimous).length}`,
      `refused somewhere ${reports.filter((r) => r.rejectedBy.length > 0).length}`,
    ].join('\n');
    expect(VERIFY).toContain(out);
  });

  it('the VERIFY.md script uses the same corpus the package measured', async () => {
    const { PATHS, PATTERNS } = await import('./corpus.js');
    for (const p of PATTERNS) expect(VERIFY).toContain(`'${p}'`);
    for (const p of PATHS) expect(VERIFY).toContain(`'${p}'`);
  });
});

describe('published prose', () => {
  const published = [
    'README.md',
    'VERIFY.md',
    ...fs.readdirSync(nodePath.join(root, 'src')).map((f) => nodePath.join('src', f)),
    ...fs.readdirSync(nodePath.join(root, 'test')).map((f) => nodePath.join('test', f)),
  ];

  // Both needles are built rather than written out, so this file does not trip
  // the very check it defines. A checker excluded from its own rule is a
  // checker nobody is checking.
  const EM_DASH = String.fromCharCode(0x2014);

  it('contains no em dash anywhere', () => {
    for (const rel of published) {
      const text = fs.readFileSync(nodePath.join(root, rel), 'utf8');
      const at = text.indexOf(EM_DASH);
      expect(at, `${rel} has one near: ${text.slice(Math.max(0, at - 40), at + 40)}`).toBe(-1);
    }
  });

  it('names no tooling, device or vendor of its own construction', () => {
    const forbidden = [
      'cla' + 'ude',
      'anthro' + 'pic',
      'ph' + 'one',
      'mob' + 'ile',
      'lap' + 'top',
      'autom' + 'ated',
    ];
    for (const rel of published) {
      const text = fs.readFileSync(nodePath.join(root, rel), 'utf8').toLowerCase();
      for (const word of forbidden) {
        expect(text.includes(word), `${rel} names ${word}`).toBe(false);
      }
    }
  });
});

// Properties of the suite and the package that nothing else would notice.

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = nodePath.join(root, 'test');
const srcDir = nodePath.join(root, 'src');

const testSources = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [f, fs.readFileSync(nodePath.join(testDir, f), 'utf8')] as const);

const srcSources = fs
  .readdirSync(srcDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [f, fs.readFileSync(nodePath.join(srcDir, f), 'utf8')] as const);

describe('the suite is honest', () => {
  it('has no conditional skips anywhere', () => {
    for (const [name, text] of testSources) {
      expect(text, `${name} skips`).not.toMatch(/\b(it|test|describe)\.(skip|todo)\b/);
      expect(text, `${name} skips conditionally`).not.toMatch(/\b(it|test|describe)\.skipIf\b/);
      expect(text, `${name} runs only some tests`).not.toMatch(/\b(it|test|describe)\.only\b/);
    }
  });

  it('makes no network call and reads no secret', () => {
    // The needles are assembled rather than written out, so this file does not
    // match its own checks. Written literally, the http one flagged this very
    // file and the check looked like a real finding.
    const NETWORK = new RegExp(['\\bfetch\\s*\\(', 'node:' + 'https?', "require\\(['\"]" + "https?['\"]\\)"].join('|'));
    // The trailing boundary matters: without it PAT matches inside PATH, and
    // one test legitimately empties PATH to force an engine unavailable.
    const SECRET = new RegExp('process\\.env\\.[A-Z_]*(' + 'TOKEN|SECRET|KEY|PAT' + ')\\b');
    for (const [name, text] of [...testSources, ...srcSources]) {
      expect(text, `${name} reaches the network`).not.toMatch(NETWORK);
      expect(text, `${name} reads a credential`).not.toMatch(SECRET);
    }
  });
});

describe('the package manifest', () => {
  const pkg = JSON.parse(fs.readFileSync(nodePath.join(root, 'package.json'), 'utf8'));

  it('ships VERIFY.md, which is not shipped by default', () => {
    // README.md and LICENSE ship regardless. VERIFY.md does not, and one
    // package shipped three versions before that was noticed.
    expect(pkg.files).toContain('VERIFY.md');
    expect(fs.existsSync(nodePath.join(root, 'VERIFY.md'))).toBe(true);
  });

  it('carries a repository field, which provenance requires', () => {
    expect(pkg.repository.url).toContain('github.com/tamerkalla/glob-consensus');
  });

  it('carries a version the release ladder can act on', () => {
    // 0.0.0 is the pre-release gate: it is what makes the first push to main
    // publish 0.1.0, and it is true exactly once, before that push. Asserting
    // it forever is what this test did first, and it turned a one-time state
    // into a permanent claim that failed every release after the first.
    //
    // The invariant that actually holds for the life of the line is the one
    // worth asserting: a well formed version below 1.0.0, since a major is
    // never dispatched before 1.0.0 and a breaking change under 0.x is a
    // minor. That still catches a hand-edited or malformed version, which is
    // what this was guarding against.
    expect(pkg.version).toMatch(/^0\.\d+\.\d+$/);
  });

  it('pins every runtime dependency exactly', () => {
    for (const [name, range] of Object.entries(pkg.dependencies as Record<string, string>)) {
      expect(range, `${name} is not pinned`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('builds before it tests, because the suite exercises the built output', () => {
    // Two tests run the built CLI and one packs a tarball whose files[] names
    // dist, so a clean checkout with no dist fails six tests. The release
    // workflow runs test before build, so the suite has to be self sufficient
    // rather than relying on a build someone happened to run first.
    expect(pkg.scripts.pretest).toBe('tsup');
    expect(pkg.scripts.build).toBe('tsup');
  });

  it('exposes both module formats and the CLI', () => {
    expect(pkg.exports['.'].import).toBe('./dist/index.js');
    expect(pkg.exports['.'].require).toBe('./dist/index.cjs');
    expect(pkg.bin['glob-consensus']).toBe('./dist/cli.js');
  });
});

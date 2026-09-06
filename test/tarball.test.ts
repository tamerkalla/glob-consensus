// Pack the package, install the tarball into an empty directory, and exercise
// every published entry point the way a stranger would.
//
// This is the only test that can catch a missing shebang in the built CLI, an
// export that resolves in the repository and vanishes from the tarball, or a
// file listed in the manifest that was never written.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..');

let workspace: string;
let installed: string;

function run(cmd: string, args: string[], cwd: string) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

beforeAll(() => {
  workspace = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'glob-consensus-pack-'));
  const packDir = nodePath.join(workspace, 'pack');
  installed = nodePath.join(workspace, 'consumer');
  fs.mkdirSync(packDir);
  fs.mkdirSync(installed);

  // npm pack --json output is not stable across npm majors, so the tarball is
  // found by looking in an empty directory rather than by parsing that output.
  const packed = run('npm', ['pack', '--pack-destination', packDir], root);
  expect(packed.status, packed.stderr).toBe(0);
  const tarballs = fs.readdirSync(packDir).filter((f) => f.endsWith('.tgz'));
  expect(tarballs.length, 'expected exactly one tarball').toBe(1);

  fs.writeFileSync(
    nodePath.join(installed, 'package.json'),
    JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }) + '\n'
  );
  const install = run(
    'npm',
    ['install', '--no-audit', '--no-fund', nodePath.join(packDir, tarballs[0] as string)],
    installed
  );
  expect(install.status, install.stderr).toBe(0);
}, 240_000);

afterAll(() => {
  if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
});

describe('a clean install of the packed tarball', () => {
  it('ships README.md, LICENSE and VERIFY.md', () => {
    const dir = nodePath.join(installed, 'node_modules', 'glob-consensus');
    for (const f of ['README.md', 'LICENSE', 'VERIFY.md']) {
      expect(fs.existsSync(nodePath.join(dir, f)), `${f} missing from the tarball`).toBe(true);
    }
  });

  it('the tarball README carries the demo block and the badge row', () => {
    const readme = fs.readFileSync(
      nodePath.join(installed, 'node_modules', 'glob-consensus', 'README.md'),
      'utf8'
    );
    expect(readme).toContain("$ npx glob-consensus 'src/**' src/.hidden/file.ts");
    expect(readme).toContain('3 different answers for one pattern and one path.');
    expect(readme).toContain('img.shields.io/npm/v/glob-consensus.svg');
    expect(readme).toContain('provenance-attested-brightgreen');
  });

  it('works as ESM', () => {
    fs.writeFileSync(
      nodePath.join(installed, 'esm.mjs'),
      "import { consensus, ENGINES } from 'glob-consensus';\n" +
        "const r = consensus('src/**', ['src/.hidden/file.ts']);\n" +
        'console.log(ENGINES.length, r.distinctVerdictCounts[0], r.rejectedBy.join(","));\n'
    );
    const out = run(process.execPath, ['esm.mjs'], installed);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout.trim()).toBe('6 3 typescript');
  });

  it('works as CJS', () => {
    fs.writeFileSync(
      nodePath.join(installed, 'cjs.cjs'),
      "const { consensus, ENGINES } = require('glob-consensus');\n" +
        "const r = consensus('src/**', ['src/.hidden/file.ts']);\n" +
        'console.log(ENGINES.length, r.distinctVerdictCounts[0], r.rejectedBy.join(","));\n'
    );
    const out = run(process.execPath, ['cjs.cjs'], installed);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout.trim()).toBe('6 3 typescript');
  });

  it('exposes a runnable CLI through node_modules/.bin', () => {
    // Invoked through the bin link, not through node, because that is the only
    // way a missing shebang in the BUILT output shows up.
    const bin = nodePath.join(installed, 'node_modules', '.bin', 'glob-consensus');
    expect(fs.existsSync(bin)).toBe(true);
    const out = run(bin, ['src/**', 'src/.hidden/file.ts'], installed);
    expect(out.status, out.stderr).toBe(1);
    expect(out.stdout).toContain('3 different answers for one pattern and one path.');
    expect(out.stdout).toContain('typescript   rejected: cannot end in a recursive directory wildcard');
  });

  it('ships type declarations for both formats', () => {
    const dir = nodePath.join(installed, 'node_modules', 'glob-consensus', 'dist');
    expect(fs.existsSync(nodePath.join(dir, 'index.d.ts'))).toBe(true);
    expect(fs.existsSync(nodePath.join(dir, 'index.d.cts'))).toBe(true);
  });
});

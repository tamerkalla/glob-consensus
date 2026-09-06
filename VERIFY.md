# Verify this package

This reproduces the headline claim from a clean install, using only the
published package. It takes under a minute and needs no checkout of this
repository.

## 1. Install from the registry

In an empty directory:

```
npm init -y
npm i glob-consensus
```

## 2. Reproduce the headline

```
npx glob-consensus 'src/**' src/.hidden/file.ts
```

Expected output, exactly:

```
src/** vs src/.hidden/file.ts

  git          match
  micromatch   no match
  minimatch    no match
  node         no match
  picomatch    no match
  typescript   rejected: cannot end in a recursive directory wildcard

3 different answers for one pattern and one path.
```

The command exits `1`, because the engines did not agree. That exit code is
the finding, not a failure.

## 3. Reproduce the counts

The README claims that 19 of 25 ordinary patterns are read differently by at
least one of the six engines, and that 6 are read identically by all of them.
Save this as `check.mjs` and run `node check.mjs`:

```js
import { consensus } from 'glob-consensus';

const patterns = [
  '**/*.test.ts', '*.log', 'src/**', 'src/**/*', 'node_modules',
  'node_modules/', '/dist', 'dist/', '**/node_modules/**', '.*',
  '**/.*', '*', '**', 'src/*.ts', '**/*.{ts,tsx}', 'test/**/*.spec.js',
  'coverage', 'build/**/*', '**/__tests__/**', '*.min.js',
  'docs/**/*.md', '.env*', '**/*.d.ts', 'packages/*/src/**', '**/*.ts',
];
const paths = [
  'src/index.ts', 'src/a/b/index.test.ts', 'index.test.ts',
  'node_modules/foo/index.js', 'src/node_modules/foo/index.js',
  'dist/main.js', '.env', '.env.local', 'src/.hidden/file.ts',
  '.github/workflows/ci.yml', 'test/a.spec.js', 'packages/a/src/x.ts',
  'docs/readme.md', 'a.min.js', 'types/x.d.ts', 'coverage/lcov.info',
  'build/x/y.js', 'src/__tests__/a.ts', 'src/foo.tsx', 'a.log',
];

const reports = patterns.map((p) => consensus(p, paths));
console.log('patterns', patterns.length);
console.log('agree', reports.filter((r) => r.unanimous).length);
console.log('differ', reports.filter((r) => !r.unanimous).length);
console.log('refused somewhere', reports.filter((r) => r.rejectedBy.length > 0).length);
```

Expected output, exactly:

```
patterns 25
agree 6
differ 19
refused somewhere 5
```

## 4. Check the provenance

```
npm view glob-consensus dist.attestations
```

A published version built by the release workflow reports an attestation. The
very first published version of any package here is pushed with a token
instead, because npm does not allow a trusted publisher to be configured until
the package exists, so that one has none.

## What a failure means

If step 2 or step 3 disagrees with what is written above, the engines have
changed their behaviour since these numbers were measured. That is worth
reporting as an issue: the numbers are claims about the exact engine versions
this package depends on, and they are asserted in its own test suite.

# glob-consensus

**`src/**` is a match to git, a syntax error to tsconfig, and a non-match to
every glob matcher on npm. This prints all six answers side by side.**

For anyone whose ignore, exclude or include pattern is not doing what they
expected.

[![build](https://github.com/tamerkalla/glob-consensus/actions/workflows/release.yml/badge.svg)](https://github.com/tamerkalla/glob-consensus/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/glob-consensus.svg)](https://www.npmjs.com/package/glob-consensus)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![provenance](https://img.shields.io/badge/provenance-attested-brightgreen.svg)](https://www.npmjs.com/package/glob-consensus)

```
$ npx glob-consensus 'src/**' src/.hidden/file.ts

src/** vs src/.hidden/file.ts

  git          match
  micromatch   no match
  minimatch    no match
  node         no match
  picomatch    no match
  typescript   rejected: cannot end in a recursive directory wildcard

3 different answers for one pattern and one path.
```

## Why

A glob pattern is not one language. It is a family of dialects that share a
syntax and disagree about what the syntax means, and you write the same string
into four or five of them in a normal week: a `.gitignore`, a `tsconfig.json`,
an ESLint config, a bundler config, a test runner's `include`.

When the pattern does not do what you expected, no tool tells you why, because
each one answers only for itself. None of them says "the other five read this
differently."

Over 25 ordinary patterns and 20 ordinary paths, measured against the exact
engine versions this package depends on:

- **19 of the 25 patterns** are not read the same way by all six engines.
- **5 of them** are refused outright by one engine and accepted by the other
  five. All five end in `**`, which TypeScript rejects as a syntax error and
  everything else treats as ordinary.
- Of the **400** pattern and path pairs drawn from the patterns every engine
  accepts, **48** get different answers.
- **6 patterns** are read identically by all six. Those are the ones that are
  actually portable.

## Install

```
npm i glob-consensus
```

## Use

```js
import { consensus } from 'glob-consensus';

const report = consensus('**/*.{ts,tsx}', ['src/a.ts', 'a.log']);

console.log(report.unanimous);
console.log(report.rejectedBy);
console.log(report.distinctVerdictCounts);
```

That prints:

```
false
[]
[ 2, 1 ]
```

Braces are expanded by the three npm matchers and by Node, and not by git or by
tsconfig, so `src/a.ts` gets two different answers while `a.log` gets one.

## The engines

| engine | what it stands for | how it is asked |
|---|---|---|
| `git` | your `.gitignore` | `git check-ignore` against a temporary tree |
| `typescript` | your `tsconfig.json` `include` | `ts.parseJsonConfigFileContent` |
| `minimatch` | ESLint, mocha and much of the older ecosystem | the library |
| `picomatch` | Vite, rollup, chokidar, tinyglobby | the library |
| `micromatch` | lint-staged, webpack | the library |
| `node` | `path.matchesGlob` in Node itself | the built in |

This package implements no matching logic of its own. Every verdict comes from
an engine that already exists, which is why the answer to "is this correct" is
never a matter of opinion.

Two of the engines answer about a filesystem rather than about a string, so
those two are asked by building a temporary tree of empty files and removing it
again. Nothing is written outside a directory this package created, and a path
that tries to climb out of one is refused.

## API

```ts
type Verdict = 'match' | 'no-match' | 'rejected' | 'unavailable';

function consensus(pattern: string, paths?: string[]): ConsensusReport;
const ENGINES: readonly EngineName[];
```

`rejected` and `no-match` are different states and are never merged. An engine
that refuses a pattern has told you something much more useful than an engine
that simply did not match, and folding the two together would hide it.
`unavailable` is a third thing again: it means the engine could not be
consulted on this machine, which is what happens to the `git` engine when there
is no `git` on `PATH`.

`consensus` throws `TypeError` for a non-string pattern or a paths array that
is not an array of strings, and `RangeError` for an empty pattern or a path
that is absolute or contains a parent segment. It throws for nothing else: an
engine that cannot answer reports `unavailable` rather than raising.

The command line exits `0` when every engine agreed and `1` when they did not,
so it can gate a script.

## What this does not do

It does not tell you which engine is right. There is no right: the engines are
documenting different products, and every one of them is correct about itself.

It does not recommend a portable pattern, because that would be a claim about
engine versions this package does not pin.

It does not enumerate files. The question is about one pattern.

## Related

`host-consensus` asks the same shape of question about a different string:
whether independent URL parsers agree on the host of one URL. `host-consensus`
compares URL parsers on a host, `glob-consensus` compares path matchers on a
glob. See <https://www.npmjs.com/package/host-consensus>.

## Verifying this package

See `VERIFY.md`, which is shipped inside the published tarball and reproduces
the headline claim from a clean install in under a minute.

## License

MIT

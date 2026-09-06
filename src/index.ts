// One pattern string, asked of every place a developer actually writes one.
//
// This package implements no matching logic of its own. Every verdict below is
// produced by an engine that already exists and that somebody already ships,
// which is what makes correctness here cheap to settle: the question is never
// "is this the right answer", it is "what did that engine actually say".

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import { minimatch } from 'minimatch';
import picomatchNs from 'picomatch';
import micromatchNs from 'micromatch';
import * as ts from 'typescript';

/**
 * `match` and `no-match` mean the engine was consulted and answered.
 * `rejected` means the engine refused the pattern outright.
 * `unavailable` means the engine could not be consulted at all.
 *
 * These are four states and never three. Folding `rejected` into `no-match`
 * hides the sharpest thing this package has to report, which is that a pattern
 * can be ordinary everywhere and a hard error in one place.
 */
export type Verdict = 'match' | 'no-match' | 'rejected' | 'unavailable';

export type EngineName =
  | 'git'
  | 'micromatch'
  | 'minimatch'
  | 'node'
  | 'picomatch'
  | 'typescript';

/** Alphabetical, so two runs print in the same order. */
export const ENGINES: readonly EngineName[] = Object.freeze([
  'git',
  'micromatch',
  'minimatch',
  'node',
  'picomatch',
  'typescript',
] as const);

export interface EngineResult {
  engine: EngineName;
  /**
   * Whether the engine could be consulted at all. An engine missing from this
   * machine is a different thing from an engine that read the pattern and
   * refused it, and with no paths supplied there are no verdicts to infer that
   * difference from, so it is stated rather than derived.
   */
  available: boolean;
  /** False when the engine refuses the pattern. Meaningless when unavailable. */
  accepts: boolean;
  /** Present only when the engine refused, or could not be consulted. */
  reason?: string;
  /** One verdict per requested path. Empty when no paths were given. */
  verdicts: Verdict[];
}

export interface ConsensusReport {
  pattern: string;
  paths: string[];
  engines: EngineResult[];
  acceptedBy: EngineName[];
  rejectedBy: EngineName[];
  /** Every engine that could be consulted agreed about everything. */
  unanimous: boolean;
  /** How many distinct verdicts came back for each path. */
  distinctVerdictCounts: number[];
}

// CJS interop hides a default export one level deeper, and sometimes two.
// Unwrapping defensively costs nothing and a wrong unwrap looks like a library
// that silently matches nothing.
function unwrap<T>(mod: unknown): T {
  let value: unknown = mod;
  for (let i = 0; i < 2; i += 1) {
    if (value && typeof value === 'object' && 'default' in value) {
      value = (value as { default: unknown }).default;
    }
  }
  return value as T;
}

const picomatch = unwrap<typeof picomatchNs>(picomatchNs);
const micromatch = unwrap<typeof micromatchNs>(micromatchNs);

// TypeScript reports an unusable file specification as a diagnostic rather than
// by throwing, so the diagnostic is what has to be read. Matched by code, never
// by message text: the text is localised and the code is not.
const TS_INVALID_SPEC_CODES = new Set([5010, 5011]);

function isPlainRelative(p: string): boolean {
  if (p.length === 0) return false;
  if (nodePath.isAbsolute(p)) return false;
  return !p
    .split(/[\\/]/)
    .some((segment) => segment === '..');
}

/**
 * A real tree of empty files, because two of the six engines answer about a
 * filesystem rather than about a string, and asking them anything else would
 * be measuring an imitation of them.
 */
function withTree<T>(paths: string[], fn: (root: string) => T): T {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'glob-consensus-'));
  try {
    for (const p of paths) {
      const abs = nodePath.join(root, p);
      fs.mkdirSync(nodePath.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, '');
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

type Answer = { accepts: true; verdicts: Verdict[] } | { accepts: false; reason: string };

function fromPredicate(
  paths: string[],
  isMatch: (p: string) => boolean
): Answer {
  try {
    // Ask once with a throwaway input first, so a pattern the engine refuses is
    // reported as a refusal even when no paths were supplied.
    isMatch(paths[0] ?? 'a');
  } catch (e) {
    return { accepts: false, reason: (e as Error).message };
  }
  const verdicts: Verdict[] = [];
  for (const p of paths) {
    try {
      verdicts.push(isMatch(p) ? 'match' : 'no-match');
    } catch (e) {
      return { accepts: false, reason: (e as Error).message };
    }
  }
  return { accepts: true, verdicts };
}

function gitAnswer(pattern: string, paths: string[]): Answer | { unavailable: string } {
  return withTree(paths, (root) => {
    // Hermetic: a user's global excludes file or system config must not change
    // what this reports, or two machines disagree for a reason that has nothing
    // to do with the pattern.
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    };
    const init = spawnSync('git', ['init', '-q', root], { env, encoding: 'utf8' });
    if (init.error || init.status !== 0) {
      return { unavailable: 'git is not available on PATH' };
    }
    fs.writeFileSync(nodePath.join(root, '.gitignore'), pattern + '\n');
    if (paths.length === 0) {
      // Nothing to ask about, but git accepted the file: every line is legal in
      // a .gitignore, so there is no refusal to report.
      return { accepts: true, verdicts: [] };
    }
    const res = spawnSync(
      'git',
      ['-C', root, 'check-ignore', '--no-index', '--', ...paths],
      { env, encoding: 'utf8' }
    );
    if (res.error) return { unavailable: 'git is not available on PATH' };
    // Exit 1 means "none of these are ignored", which is an answer. Only 128 and
    // above is a failure. Reading the exit code as a boolean turns every pattern
    // that matches nothing into a fake refusal.
    if (res.status !== 0 && res.status !== 1) {
      return { accepts: false, reason: (res.stderr || 'git refused the pattern').trim() };
    }
    const ignored = new Set((res.stdout || '').split('\n').filter(Boolean));
    return { accepts: true, verdicts: paths.map((p) => (ignored.has(p) ? 'match' : 'no-match')) };
  });
}

function typescriptAnswer(pattern: string, paths: string[]): Answer {
  return withTree(paths, (root) => {
    const parsed = ts.parseJsonConfigFileContent(
      { include: [pattern], compilerOptions: { allowJs: true } },
      ts.sys,
      root
    );
    const invalid = parsed.errors.find((d) => TS_INVALID_SPEC_CODES.has(d.code));
    if (invalid) {
      return {
        accepts: false,
        reason: ts.flattenDiagnosticMessageText(invalid.messageText, ' '),
      };
    }
    const included = new Set(
      parsed.fileNames.map((f) => nodePath.relative(root, f).split(nodePath.sep).join('/'))
    );
    return {
      accepts: true,
      verdicts: paths.map((p) => (included.has(p) ? 'match' : 'no-match')),
    };
  });
}

function nodeAnswer(pattern: string, paths: string[]): Answer | { unavailable: string } {
  const matchesGlob = (nodePath as unknown as {
    matchesGlob?: (p: string, pattern: string) => boolean;
  }).matchesGlob;
  if (typeof matchesGlob !== 'function') {
    return { unavailable: 'path.matchesGlob is not available in this Node runtime' };
  }
  return fromPredicate(paths, (p) => matchesGlob(p, pattern));
}

function isUnavailable(a: Answer | { unavailable: string }): a is { unavailable: string } {
  return 'unavailable' in a;
}

/**
 * Ask every engine what it makes of one pattern, and of each path against it.
 */
export function consensus(pattern: string, paths: string[] = []): ConsensusReport {
  if (typeof pattern !== 'string') {
    throw new TypeError('pattern must be a string');
  }
  if (pattern.length === 0) {
    throw new RangeError('pattern must not be empty');
  }
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
    throw new TypeError('paths must be an array of strings');
  }
  // Two engines answer by building a real tree, so a path that climbs out of it
  // would write outside a directory this package created. Refused rather than
  // sanitised: a silently rewritten path would be answering about a different
  // question than the one that was asked.
  const bad = paths.find((p) => !isPlainRelative(p));
  if (bad !== undefined) {
    throw new RangeError(
      `paths must be relative and must not contain a parent segment: ${JSON.stringify(bad)}`
    );
  }

  const frozenPaths = [...paths];
  const answers: Record<EngineName, Answer | { unavailable: string }> = {
    git: gitAnswer(pattern, frozenPaths),
    micromatch: fromPredicate(frozenPaths, (p) => micromatch.isMatch(p, pattern)),
    minimatch: fromPredicate(frozenPaths, (p) => minimatch(p, pattern)),
    node: nodeAnswer(pattern, frozenPaths),
    picomatch: fromPredicate(frozenPaths, (p) => picomatch.isMatch(p, pattern)),
    typescript: typescriptAnswer(pattern, frozenPaths),
  };

  const engines: EngineResult[] = ENGINES.map((name) => {
    const a = answers[name];
    if (isUnavailable(a)) {
      return {
        engine: name,
        available: false,
        accepts: false,
        reason: a.unavailable,
        verdicts: frozenPaths.map(() => 'unavailable' as Verdict),
      };
    }
    if (!a.accepts) {
      return {
        engine: name,
        available: true,
        accepts: false,
        reason: a.reason,
        verdicts: frozenPaths.map(() => 'rejected' as Verdict),
      };
    }
    return { engine: name, available: true, accepts: true, verdicts: a.verdicts };
  });

  const available = engines.filter((e) => e.available);
  const acceptedBy = available.filter((e) => e.accepts).map((e) => e.engine);
  const rejectedBy = available.filter((e) => !e.accepts).map((e) => e.engine);

  const distinctVerdictCounts = frozenPaths.map((_, i) => {
    const seen = new Set(available.map((e) => e.verdicts[i]));
    return seen.size;
  });

  const unanimous =
    rejectedBy.length === 0 && distinctVerdictCounts.every((n) => n <= 1);

  return {
    pattern,
    paths: frozenPaths,
    engines,
    acceptedBy,
    rejectedBy,
    unanimous,
    distinctVerdictCounts,
  };
}

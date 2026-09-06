// The command a stranger pastes. Everything it prints comes from consensus();
// this file only lays it out.
//
// Entry logic is wrapped in main() rather than run at module scope, because a
// dual ESM and CJS build breaks on import.meta and on top-level await.

import { consensus, ENGINES, type ConsensusReport } from './index.js';

const USAGE = `glob-consensus <pattern> [path ...]

Prints how each place you write a glob pattern actually reads it.

  glob-consensus 'src/**' src/.hidden/file.ts
  glob-consensus '**/*.{ts,tsx}' src/a.ts src/a.tsx
`;

// The library keeps the engine's own message in full. The command line shows
// the clause that says what is wrong, because the rest of a TypeScript
// diagnostic repeats the pattern the reader just typed.
function shortReason(reason: string | undefined): string {
  if (!reason) return 'no reason given';
  const withoutSpec = reason.split(" ('")[0] as string;
  return withoutSpec.replace(/^File specification /, '').replace(/\.$/, '');
}

function render(report: ConsensusReport): string {
  const lines: string[] = [];
  const width = Math.max(...ENGINES.map((e) => e.length));

  if (report.paths.length === 0) {
    lines.push(report.pattern);
    lines.push('');
    for (const e of report.engines) {
      const state = !e.available ? 'unavailable' : e.accepts ? 'accepts' : `rejected: ${shortReason(e.reason)}`;
      lines.push(`  ${e.engine.padEnd(width)}   ${state}`);
    }
    lines.push('');
    lines.push(
      report.rejectedBy.length === 0
        ? `All ${report.acceptedBy.length} engines accept this pattern.`
        : `${report.rejectedBy.length} of ${report.acceptedBy.length + report.rejectedBy.length} engines refuse this pattern.`
    );
    return lines.join('\n');
  }

  for (let i = 0; i < report.paths.length; i += 1) {
    const path = report.paths[i] as string;
    if (i > 0) lines.push('');
    lines.push(`${report.pattern} vs ${path}`);
    lines.push('');
    for (const e of report.engines) {
      let cell: string;
      if (!e.available) cell = `unavailable: ${shortReason(e.reason)}`;
      else if (!e.accepts) cell = `rejected: ${shortReason(e.reason)}`;
      else cell = e.verdicts[i] === 'match' ? 'match' : 'no match';
      lines.push(`  ${e.engine.padEnd(width)}   ${cell}`);
    }
    lines.push('');
    const n = report.distinctVerdictCounts[i] as number;
    lines.push(
      n === 1
        ? '1 answer. Every engine agrees.'
        : `${n} different answers for one pattern and one path.`
    );
  }
  return lines.join('\n');
}

function main(argv: string[]): number {
  const args = argv.filter((a) => a !== '--');
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    process.stdout.write(USAGE);
    return args.length === 0 ? 1 : 0;
  }
  const [pattern, ...paths] = args as [string, ...string[]];
  let report: ConsensusReport;
  try {
    report = consensus(pattern, paths);
  } catch (e) {
    process.stderr.write(`glob-consensus: ${(e as Error).message}\n`);
    return 2;
  }
  process.stdout.write(render(report) + '\n');
  // Exit code carries the finding, so a script can gate on it: 0 when every
  // engine agreed, 1 when they did not.
  return report.unanimous ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));

export { render, main };

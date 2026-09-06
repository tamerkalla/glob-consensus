import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: false,
  target: 'node20',
  // A bin entry needs a shebang in the BUILT output, not only in the source.
  // Only a tarball test that invokes the CLI through node_modules/.bin catches
  // its absence, so it is banner-injected here rather than left to the bundler.
  banner: ({ format }) => (format === 'esm' ? { js: '#!/usr/bin/env node' } : {}),
});

// The workflows are parsed as YAML and asserted structurally, never grepped.
//
// YAML 1.1 reads a bare `on:` key as the boolean true, so a naive w["on"] raises
// where w[true] succeeds. Four workflows were once reported as conforming when
// they were not, by a check that read the document describing them instead of
// the file.

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..');

function loadWorkflow(name: string): Record<string, any> {
  const text = fs.readFileSync(nodePath.join(root, '.github', 'workflows', name), 'utf8');
  return parse(text) as Record<string, any>;
}

function triggers(w: Record<string, any>): Record<string, any> {
  // Handle both spellings rather than assuming either.
  const key = Object.prototype.hasOwnProperty.call(w, 'on') ? 'on' : (true as unknown as string);
  const value = w[key];
  expect(value, 'workflow has no trigger block under "on" or true').toBeTruthy();
  return value as Record<string, any>;
}

const release = loadWorkflow('release.yml');
const ci = loadWorkflow('ci.yml');
const releaseSteps = release.jobs.release.steps as Array<Record<string, any>>;

describe('release.yml', () => {
  it('parses as YAML and is a real workflow', () => {
    expect(release.name).toBe('Release');
    expect(release.jobs.release.permissions).toEqual({
      contents: 'write',
      'id-token': 'write',
    });
  });

  it('runs on a push to main and on dispatch', () => {
    const on = triggers(release);
    expect(on.push.branches).toEqual(['main']);
    expect(Object.keys(on.workflow_dispatch.inputs).sort()).toEqual(['auth', 'bump']);
  });

  it('has two setup-node steps, and the OIDC one carries no registry-url', () => {
    const setups = releaseSteps.filter((s) => String(s.uses ?? '').startsWith('actions/setup-node'));
    expect(setups.length).toBe(2);
    const oidc = setups.filter((s) => !('registry-url' in (s.with ?? {})));
    const token = setups.filter((s) => 'registry-url' in (s.with ?? {}));
    expect(oidc.length).toBe(1);
    expect(token.length).toBe(1);
    // A registry URL on the OIDC path writes an .npmrc carrying a token
    // placeholder job-wide, npm then finds a credential and never attempts the
    // exchange, and the publish authenticates as nobody.
    expect(String(oidc[0]!.if)).toContain("!= 'token'");
  });

  it('the OIDC publish step declares no auth environment variable at all', () => {
    const oidcPublish = releaseSteps.find((s) => s.name === 'Publish (OIDC)')!;
    expect(oidcPublish).toBeTruthy();
    // Absent entirely, not empty. An empty value still defeats the exchange.
    expect(oidcPublish.env).toBeUndefined();
    expect(String(oidcPublish.run)).toContain('npm publish --access public');
  });

  it('the token publish step is the only one carrying a credential', () => {
    const tokenPublish = releaseSteps.find((s) => s.name === 'Publish (token)')!;
    expect(Object.keys(tokenPublish.env)).toEqual(['NODE_AUTH_TOKEN']);
    const withEnv = releaseSteps.filter((s) => s.env && 'NODE_AUTH_TOKEN' in s.env);
    expect(withEnv.length).toBe(1);
  });

  it('the bump step reads the version from package.json, not from npm version stdout', () => {
    const bump = releaseSteps.find((s) => s.id === 'bump')!;
    const run = String(bump.run);
    expect(run).toContain(`node -p "require('./package.json').version"`);
    // npm version prints its result with a leading v, and capturing that stdout
    // is what produced vv0.1.5 tags in three repositories at once.
    expect(run).not.toMatch(/version=\$\(npm version/);
    expect(run).not.toMatch(/\$\(npm version [^)]*\)/);
  });

  it('publishes before pushing the version commit', () => {
    const names = releaseSteps.map((s) => s.name ?? s.uses);
    expect(names.indexOf('Publish (token)')).toBeLessThan(
      names.indexOf('Push version commit and tag')
    );
    expect(names.indexOf('Publish (OIDC)')).toBeLessThan(
      names.indexOf('Push version commit and tag')
    );
  });

  it('creates a release titled v<version> with no doubled v', () => {
    const rel = releaseSteps.find((s) => s.name === 'Create GitHub Release')!;
    expect(String(rel.run)).toContain('"v${{ steps.bump.outputs.version }}"');
    expect(String(rel.run)).not.toContain('vv');
  });

  it('runs the whole quality bar before publishing', () => {
    const runs = releaseSteps.map((s) => String(s.run ?? ''));
    for (const cmd of ['npm ci', 'npm run typecheck', 'npm test', 'npm run build']) {
      expect(runs.some((r) => r.trim() === cmd), `missing ${cmd}`).toBe(true);
    }
  });
});

describe('ci.yml', () => {
  it('does not run on main', () => {
    const on = triggers(ci);
    expect(on.push['branches-ignore']).toEqual(['main']);
    expect(on.push.branches).toBeUndefined();
  });

  it('needs no secret, so it goes green on a fork', () => {
    const text = fs.readFileSync(nodePath.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(text).not.toContain('secrets.');
    for (const step of ci.jobs.verify.steps as Array<Record<string, any>>) {
      expect(step.env).toBeUndefined();
    }
  });

  it('runs the same four commands the release path runs', () => {
    const runs = (ci.jobs.verify.steps as Array<Record<string, any>>).map((s) => String(s.run ?? ''));
    for (const cmd of ['npm ci', 'npm run typecheck', 'npm test', 'npm run build']) {
      expect(runs.some((r) => r.trim() === cmd), `missing ${cmd}`).toBe(true);
    }
  });
});

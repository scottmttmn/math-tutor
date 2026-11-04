import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const capacitor = { registerPlugin: () => ({}) };
const { currentBuild, releaseBuild } = load('src/lib/appUpdate.ts', { '@capacitor/core': capacitor });

test('the published build\'s number is read from its release notes', () => {
  assert.equal(releaseBuild('Build: 412\nFrom: main at 1a2b3c4'), 412);
  assert.equal(releaseBuild('From: claude/x\nBuild: 7'), 7);
  assert.equal(releaseBuild('No number here'), null);
  assert.equal(releaseBuild(undefined), null);
});

test('only a numbered (CI) build looks for updates', () => {
  assert.equal(currentBuild('412'), 412);
  assert.equal(currentBuild(''), null);
  assert.equal(currentBuild('local'), null);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareSemver, isSafeReleaseUrl, createUpdater } = require('../main/updater.cjs');

test('semver comparison handles releases and prereleases accurately', () => {
  assert.equal(compareSemver('1.0.0', '0.9.0'), 1);
  assert.equal(compareSemver('v1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('0.9.5', '1.0.0'), -1);
  assert.equal(compareSemver('1.0.0', '1.0.0-beta.1'), 1);
  assert.equal(compareSemver('1.0.1', '1.0.0'), 1);
});

test('updater validates GitHub release URLs and reports updates or errors without crashing', async () => {
  assert.equal(isSafeReleaseUrl('https://github.com/Morphling0717/WindChime/releases/tag/v1.1.0', 'Morphling0717/WindChime'), true);
  assert.equal(isSafeReleaseUrl('https://evil.example.com/releases/tag/v1.1.0', 'Morphling0717/WindChime'), false);
  assert.equal(isSafeReleaseUrl('javascript:alert(1)', 'Morphling0717/WindChime'), false);

  const opened = [];
  const updater = createUpdater({
    currentVersion: '1.0.0',
    shell: { openExternal: async url => { opened.push(url); } },
    fetch: async () => Response.json({
      tag_name: 'v1.1.0',
      name: '风铃 1.1.0',
      body: '新增功能说明',
      html_url: 'https://github.com/Morphling0717/WindChime/releases/tag/v1.1.0',
      published_at: '2026-12-01T00:00:00Z',
    }),
  });

  const info = await updater.check();
  assert.equal(info.hasUpdate, true);
  assert.equal(info.latestVersion, '1.1.0');
  assert.equal(info.error, '');
  await updater.openRelease('https://evil.example.com/phish');
  assert.equal(opened[0], 'https://github.com/Morphling0717/WindChime/releases/tag/v1.1.0');

  const offlineUpdater = createUpdater({
    currentVersion: '1.0.0',
    shell: { openExternal: async () => {} },
    fetch: async () => { throw new Error('network down'); },
  });
  const errInfo = await offlineUpdater.check();
  assert.equal(errInfo.hasUpdate, false);
  assert.match(errInfo.error, /network down/);
});

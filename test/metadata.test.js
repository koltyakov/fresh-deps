const test = require('node:test');
const assert = require('node:assert');
const { display, relativeTime, publishedOn, formatSize, escapeMarkdown } = require('../out/format');
const { metaOf: npmMetaOf, repositoryOf } = require('../out/registries/npm');
const { metaOf: goMetaOf } = require('../out/registries/go');
const { metaOf: pypiMetaOf, uploadTimes, isWarehouse } = require('../out/registries/pypi');

const NOW = Date.parse('2026-09-08T12:00:00Z');

test('relativeTime picks the largest unit that fits', () => {
  assert.strictEqual(relativeTime('2026-09-08T11:30:00Z', NOW), '30 minutes ago');
  assert.strictEqual(relativeTime('2026-09-06T12:00:00Z', NOW), '2 days ago');
  assert.strictEqual(relativeTime('2026-05-13T23:47:36Z', NOW), '4 months ago');
  assert.strictEqual(relativeTime('2017-09-26T16:00:29Z', NOW), '9 years ago');
  assert.strictEqual(relativeTime('not a date', NOW), undefined);
});

test('publishedOn pairs the exact date with how long ago it was', () => {
  const rendered = publishedOn('2026-05-13T23:47:36.171Z', NOW);
  assert.match(rendered, /2026/);
  assert.match(rendered, /\(4 months ago\)$/);
  assert.strictEqual(publishedOn(undefined, NOW), undefined);
  assert.strictEqual(publishedOn('nonsense', NOW), undefined);
});

test('formatSize reports the footprint the way a registry does', () => {
  assert.strictEqual(formatSize(512), '512 B');
  assert.strictEqual(formatSize(209281), '209 kB');
  assert.strictEqual(formatSize(2400), '2.4 kB');
  assert.strictEqual(formatSize(15_600_000), '15.6 MB');
});

test('display only prefixes Go versions', () => {
  assert.strictEqual(display('1.2.3', 'go'), 'v1.2.3');
  assert.strictEqual(display('v1.2.3', 'go'), 'v1.2.3');
  assert.strictEqual(display('1.2.3', 'npm'), '1.2.3');
});

test('escapeMarkdown keeps registry prose from reformatting the card', () => {
  assert.strictEqual(escapeMarkdown('a | b'), 'a \\| b');
  assert.strictEqual(escapeMarkdown('multi\n  line'), 'multi line');
  // A URL in a description has to survive intact, and so does ordinary punctuation.
  assert.strictEqual(escapeMarkdown('see https://github.com/a/b#readme.'), 'see https://github.com/a/b#readme.');
  assert.strictEqual(escapeMarkdown('Apache-2.0'), 'Apache-2.0');
  assert.strictEqual(escapeMarkdown('$(warning) x'), '\\$(warning) x');
});

test('npm metadata is read off the document the version lookup already fetched', () => {
  const meta = npmMetaOf({
    version: '2.88.2',
    description: 'Simplified HTTP request client.',
    license: 'Apache-2.0',
    deprecated: 'request has been deprecated',
    _npmUser: { name: 'mikeal' },
    homepage: 'https://github.com/request/request#readme',
    repository: { type: 'git', url: 'git+https://github.com/request/request.git' },
    dist: { unpackedSize: 209281, fileCount: 17 },
  });
  assert.strictEqual(meta.description, 'Simplified HTTP request client.');
  assert.strictEqual(meta.license, 'Apache-2.0');
  assert.strictEqual(meta.deprecated, 'request has been deprecated');
  assert.strictEqual(meta.publisher, 'mikeal');
  assert.strictEqual(meta.repository, 'https://github.com/request/request');
  assert.strictEqual(meta.unpackedSize, 209281);
  assert.strictEqual(meta.fileCount, 17);
});

test('npm metadata tolerates the older license shapes and no dist', () => {
  assert.strictEqual(npmMetaOf({ license: { type: 'MIT', url: 'x' } }).license, 'MIT');
  assert.strictEqual(npmMetaOf({ license: ['MIT', 'Apache-2.0'] }).license, 'MIT, Apache-2.0');
  assert.deepStrictEqual(npmMetaOf({}), {});
});

test('repositoryOf turns every git spelling into a browsable URL', () => {
  assert.strictEqual(repositoryOf('git+https://github.com/a/b.git'), 'https://github.com/a/b');
  assert.strictEqual(repositoryOf({ url: 'git://github.com/a/b.git' }), 'https://github.com/a/b');
  assert.strictEqual(repositoryOf({ url: 'git+ssh://git@github.com/a/b.git' }), 'https://github.com/a/b');
  assert.strictEqual(repositoryOf({ url: 'git@github.com:a/b.git' }), 'https://github.com/a/b');
  assert.strictEqual(repositoryOf('a/b'), undefined);
  assert.strictEqual(repositoryOf(undefined), undefined);
});

test('the Go proxy dates the latest version on the response that resolves it', () => {
  const meta = goMetaOf({
    Version: 'v1.12.0',
    Time: '2026-02-28T10:10:09Z',
    Origin: { URL: 'https://github.com/gin-gonic/gin.git' },
  });
  assert.strictEqual(meta.latestPublishedAt, '2026-02-28T10:10:09Z');
  assert.strictEqual(meta.repository, 'https://github.com/gin-gonic/gin');
  assert.deepStrictEqual(goMetaOf({ Version: 'v1.0.0' }), {});
});

test('uploadTimes dates a release by its last uploaded file', () => {
  const times = uploadTimes([
    { filename: 'requests-2.34.2-py3-none-any.whl', 'upload-time': '2026-05-14T19:25:20Z' },
    { filename: 'requests-2.34.2.tar.gz', 'upload-time': '2026-05-14T19:25:27Z' },
    { filename: 'requests-2.33.0.tar.gz', 'upload-time': '2025-01-02T00:00:00Z' },
    { filename: 'unparseable', 'upload-time': '2026-01-01T00:00:00Z' },
  ]);
  assert.strictEqual(times.get('2.34.2'), '2026-05-14T19:25:27Z');
  assert.strictEqual(times.get('2.33.0'), '2025-01-02T00:00:00Z');
  assert.strictEqual(times.size, 2);
});

test('PyPI info is only asked of an index that serves it', () => {
  assert.ok(isWarehouse('https://pypi.org/simple'));
  assert.ok(!isWarehouse('https://nexus.internal/repository/pypi/simple'));
  assert.ok(!isWarehouse('https://pypi.org.evil.example/simple'));
});

test('PyPI metadata prefers the modern licence field and drops pasted licence text', () => {
  const meta = pypiMetaOf({
    summary: 'Python HTTP for Humans.',
    license: 'Apache-2.0',
    project_urls: { Source: 'https://github.com/psf/requests', Documentation: 'https://requests.readthedocs.io' },
  });
  assert.strictEqual(meta.description, 'Python HTTP for Humans.');
  assert.strictEqual(meta.license, 'Apache-2.0');
  assert.strictEqual(meta.repository, 'https://github.com/psf/requests');
  assert.strictEqual(meta.homepage, 'https://requests.readthedocs.io');
  assert.strictEqual(pypiMetaOf({ license: 'MIT License\n\nCopyright (c) 2026 ...'.repeat(3) }).license, undefined);
  assert.strictEqual(pypiMetaOf({ license: 'MIT', license_expression: 'MIT OR Apache-2.0' }).license, 'MIT OR Apache-2.0');
});

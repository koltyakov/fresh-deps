const test = require('node:test');
const assert = require('node:assert');
const { parsePomXml } = require('../out/parsers/pomXml');
const maven = require('../out/mavenVersion');
const { versionsFromMetadata } = require('../out/registries/maven');
const { computeUpdate } = require('../out/versions');
const { schemeFor } = require('../out/schemes');

const summary = (deps) => deps.map((dep) => [dep.name, dep.spec, dep.section, dep.line]);

test('pom.xml: reads direct and managed dependencies', () => {
  const text = [
    '<project>',
    '  <dependencyManagement>',
    '    <dependencies>',
    '      <dependency>',
    '        <groupId>com.fasterxml.jackson.core</groupId>',
    '        <artifactId>jackson-databind</artifactId>',
    '        <version>[2.15,2.18)</version>',
    '      </dependency>',
    '    </dependencies>',
    '  </dependencyManagement>',
    '  <dependencies>',
    '    <dependency>',
    '      <groupId>org.junit.jupiter</groupId>',
    '      <artifactId>junit-jupiter</artifactId>',
    '      <version>5.10.0</version>',
    '    </dependency>',
    '  </dependencies>',
    '</project>',
  ].join('\n');

  assert.deepStrictEqual(summary(parsePomXml(text)), [
    ['com.fasterxml.jackson.core:jackson-databind', '[2.15,2.18)', 'dependencyManagement', 6],
    ['org.junit.jupiter:junit-jupiter', '5.10.0', 'dependencies', 14],
  ]);
});

test('pom.xml: resolves project properties and skips inherited versions', () => {
  const text = [
    '<project>',
    '  <properties>',
    '    <junit.version>5.10.1</junit.version>',
    '  </properties>',
    '  <dependencies>',
    '    <dependency>',
    '      <groupId>org.junit.jupiter</groupId>',
    '      <artifactId>junit-jupiter</artifactId>',
    '      <version>${junit.version}</version>',
    '    </dependency>',
    '    <dependency>',
    '      <groupId>org.slf4j</groupId>',
    '      <artifactId>slf4j-api</artifactId>',
    '    </dependency>',
    '  </dependencies>',
    '</project>',
  ].join('\n');

  assert.deepStrictEqual(summary(parsePomXml(text)), [
    ['org.junit.jupiter:junit-jupiter', '5.10.1', 'dependencies', 8],
  ]);
});

test('Maven versions order qualifiers and numeric components', () => {
  assert.ok(maven.compare('1.0-alpha-1', '1.0-beta-1') < 0);
  assert.ok(maven.compare('1.0-rc1', '1.0') < 0);
  assert.strictEqual(maven.compare('1.0.Final', '1.0'), 0);
  assert.ok(maven.compare('1.0-sp1', '1.0') > 0);
  assert.ok(maven.compare('1.10', '1.9') > 0);
  assert.ok(maven.isPrerelease('2.0.0-SNAPSHOT'));
  assert.ok(!maven.isPrerelease('2.0.0.Final'));
});

test('Maven ranges support bounds and unions', () => {
  const stable = { includePrerelease: false };
  assert.strictEqual(maven.baselineOf('[1.0,2.0)'), '1.0');
  assert.ok(maven.satisfies('1.9.9', '[1.0,2.0)', stable));
  assert.ok(!maven.satisfies('2.0', '[1.0,2.0)', stable));
  assert.ok(maven.satisfies('2.1', '(,1.0],[2.0,)', stable));
  assert.ok(maven.satisfies('1.0.Final', '[1.0]', stable));
});

test('Maven metadata ignores prereleases when choosing latest', () => {
  const result = versionsFromMetadata([
    '<metadata><versioning><release>1.10.0</release><versions>',
    '<version>1.9.0</version>',
    '<version>2.0.0-RC1</version>',
    '<version>1.10.0</version>',
    '</versions></versioning></metadata>',
  ].join(''));
  assert.strictEqual(result.latest, '1.10.0');
  assert.deepStrictEqual(result.all, ['1.9.0', '2.0.0-RC1', '1.10.0']);
});

test('computeUpdate uses Maven ranges rather than semver ranges', () => {
  const dep = { name: 'org.example:demo', spec: '[1.0,2.0)', line: 0, section: 'dependencies' };
  const versions = { latest: '2.1.Final', all: ['1.0', '1.8.2', '2.1.Final'] };
  const opts = { includePrerelease: false, showSatisfyingUpdates: true, scheme: schemeFor('java') };
  const update = computeUpdate(dep, versions, opts);
  assert.strictEqual(update.latest, '2.1.Final');
  assert.strictEqual(update.satisfying, '1.8.2');
  assert.strictEqual(update.inRange, false);
});

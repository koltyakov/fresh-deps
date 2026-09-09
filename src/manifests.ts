import type { ManifestKind } from './analyzer';
import type { Ecosystem } from './types';

interface ManifestDefinition { ecosystem: Ecosystem; kind: ManifestKind; test: RegExp; patterns: string[] }
const define = (ecosystem: Ecosystem, kind: ManifestKind, test: RegExp, ...patterns: string[]): ManifestDefinition => ({ ecosystem, kind, test, patterns });

/** Detection and editor selectors share one ordered registry. Specific names precede broad suffixes. */
export const manifests: readonly ManifestDefinition[] = [
  define('ansible', 'ansible', /(?:^|\/)requirements\.ya?ml$/, '**/requirements.{yml,yaml}'),
  define('bazel', 'bazel', /(?:^|\/)MODULE\.bazel$/, '**/MODULE.bazel'),
  define('vcpkg', 'vcpkg', /(?:^|\/)vcpkg\.json$/, '**/vcpkg.json'),
  define('docker', 'dockerfile', /(?:^|\/)(?:(?:Dockerfile|Containerfile)(?:[._-][\w.-]+)?|[^/]+\.(?:Dockerfile|Containerfile))$/, '**/{Dockerfile,Containerfile}{,.*,-*,_*}', '**/*.{Dockerfile,Containerfile}'),
  define('docker', 'compose', /(?:^|\/)(?:docker-)?compose(?:[._-][\w.-]+)?\.ya?ml$/, '**/{compose,docker-compose}{,.*,-*,_*}.{yml,yaml}'),
  define('helm', 'helm', /(?:^|\/)Chart\.yaml$/, '**/Chart.yaml'),
  define('swift', 'swift', /(?:^|\/)Package\.swift$/, '**/Package.swift'),
  define('conan', 'conan-py', /(?:^|\/)conanfile\.py$/, '**/conanfile.py'),
  define('conan', 'conan-txt', /(?:^|\/)conanfile\.txt$/, '**/conanfile.txt'),
  define('python', 'python-script', /\.py$/, '**/*.py'),
  define('scala', 'sbt', /(?:^|\/)(?:build\.sbt|project\/plugins\.sbt)$/, '**/build.sbt', '**/project/plugins.sbt'),
  define('conda', 'conda', /(?:^|\/)environment\.ya?ml$/, '**/environment.{yml,yaml}'),
  define('clojure', 'clojure', /(?:^|\/)deps\.edn$/, '**/deps.edn'),
  define('clojure', 'leiningen', /(?:^|\/)project\.clj$/, '**/project.clj'),
  define('npm', 'yarn-catalog', /(?:^|\/)\.yarnrc\.yml$/, '**/.yarnrc.yml'),
  define('dotnet', 'dotnet-tools', /(?:^|\/)dotnet-tools\.json$/, '**/dotnet-tools.json'),
  define('dotnet', 'dotnet-sdk', /(?:^|\/)global\.json$/, '**/global.json'),
  define('gradle', 'gradle-build', /(?:^|\/)(?:build|settings)\.gradle(?:\.kts)?$/, '**/{build,settings}.gradle{,.kts}'),
  define('gradle', 'gradle-wrapper', /(?:^|\/)gradle-wrapper\.properties$/, '**/gradle-wrapper.properties'),
  define('gradle', 'gradle-catalog', /\.versions\.toml$/, '**/*.versions.toml'),
  define('deno', 'deno', /(?:^|\/)(?:deno\.jsonc?|import[_-]map\.jsonc?)$/, '**/deno.{json,jsonc}', '**/import{_,-}map.{json,jsonc}'),
  define('githubActions', 'github-actions', /(?:^|\/)(?:action\.ya?ml|\.github\/workflows\/[^/]+\.ya?ml)$/, '**/action.{yml,yaml}', '**/.github/workflows/*.{yml,yaml}'),
  define('php', 'composer.json', /(?:^|\/)composer\.json$/, '**/composer.json'),
  define('dart', 'pubspec.yaml', /(?:^|\/)pubspec(?:_overrides)?\.yaml$/, '**/pubspec{,_overrides}.yaml'),
  define('npm', 'pnpm-workspace.yaml', /(?:^|\/)pnpm-workspace\.yaml$/, '**/pnpm-workspace.yaml'),
  define('ruby', 'Gemfile', /(?:^|\/)Gemfile$/, '**/Gemfile'),
  define('ruby', 'gemspec', /\.gemspec$/, '**/*.gemspec'),
  define('elixir', 'mix.exs', /(?:^|\/)mix\.exs$/, '**/mix.exs'),
  define('terraform', 'tflint', /(?:^|\/)\.tflint\.hcl$/, '**/.tflint.hcl'),
  define('terraform', 'terraform', /\.(?:tf|tofu)$/, '**/*.tf', '**/*.tofu'),
  define('npm', 'package.json', /(?:^|\/)package\.json$/, '**/package.json'),
  define('go', 'go.mod', /(?:^|\/)go\.(?:mod|work)$/, '**/go.{mod,work}'),
  define('rust', 'Cargo.toml', /(?:^|\/)Cargo\.toml$/, '**/Cargo.toml'),
  define('java', 'pom.xml', /(?:^|\/)pom\.xml$/, '**/pom.xml'),
  define('python', 'pyproject.toml', /(?:^|\/)pyproject\.toml$/, '**/pyproject.toml'),
  define('python', 'Pipfile', /(?:^|\/)Pipfile$/, '**/Pipfile'),
  define('python', 'requirements.txt', /(?:^|\/)(?:(?:requirements|constraints)(?:[-._][^/]*)?\.txt|[^/]+[-._]requirements\.txt|requirements\/[^/]+\.txt)$/i, '**/*.txt'),
  define('dotnet', 'nuget', /(?:\.(?:cs|fs|vb)proj|(?:^|\/)Directory\.(?:Packages|Build)\.props|(?:^|\/)packages\.config)$/i, '**/*.{cs,fs,vb}proj', '**/Directory.{Packages,Build}.props', '**/packages.config'),
];

export const manifestSelectors = [...new Set([...manifests.flatMap((entry) => entry.patterns), '**/*'])]
  .map((pattern) => ({ scheme: 'file', pattern }));

export function registeredManifest(fsPath: string): { ecosystem: Ecosystem; kind: ManifestKind } | undefined {
  const definition = manifests.find((entry) => entry.test.test(fsPath.replace(/\\/g, '/')));
  return definition ? { ecosystem: definition.ecosystem, kind: definition.kind } : undefined;
}

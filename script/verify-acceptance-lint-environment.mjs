import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const group = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/.worktrees/rocut-acceptance-20261011-6fa23f6b';
const root = join(group, '_others/rocut');
const require = createRequire(join(root, 'package.json'));
const decoder = new TextDecoder('utf-8', { fatal: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function within(path) {
  const rel = relative(resolve(group), resolve(path));
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
const restored = JSON.parse(decoder.decode(readFileSync(join(group, 'dependency-restoration.json'))));
const links = [];
for (const record of restored.packages) {
  if (!within(realpathSync(record.target))) throw Error(`Restored package escaped: ${record.key}`);
  for (const dependency of record.dependencies) {
    const actual = realpathSync(dependency.output);
    if (!within(actual) || actual !== realpathSync(dependency.target)) throw Error(`Dependency escaped: ${record.key} -> ${dependency.name}`);
    links.push({ from: record.key, name: dependency.name, actual });
  }
}
const priorCache = new Set(Object.keys(require.cache));
const config = await import(pathToFileURL(join(root, 'eslint.config.mjs')).href);
const newlyLoadedCjs = Object.keys(require.cache).filter(path => !priorCache.has(path));
const escapedCjs = newlyLoadedCjs.filter(path => !within(path));
if (escapedCjs.length) throw Error(`ESLint config CJS modules escaped: ${escapedCjs.join(', ')}`);
const command = ['node', 'node_modules/eslint/bin/eslint.js', '--print-config', 'packages/editor-contracts/src/index.ts'];
const probe = spawnSync(command[0], command.slice(1), { cwd: root, env: { ...process.env, NO_COLOR: '1' }, windowsHide: true, encoding: null, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
const printed = decoder.decode(probe.stdout ?? Buffer.alloc(0)).trim();
if (probe.status !== 0 || !printed || printed === 'undefined') throw Error(`Focused config preflight failed: ${decoder.decode(probe.stderr ?? Buffer.alloc(0))}`);
const printConfig = JSON.parse(printed);
if (!Object.keys(printConfig.rules ?? {}).length) throw Error('Configured frontend target unexpectedly has no rules');
const receipt = { version: 1, createdAt: new Date().toISOString(), root, restorationSha256: sha(readFileSync(join(group, 'dependency-restoration.json'))),
  packages: restored.packages.length, dependencyLinks: links, newlyLoadedCjs, escapedCjs, configurationEntries: config.default.length,
  command, status: probe.status, stdoutSha256: sha(probe.stdout), stderrSha256: sha(probe.stderr), configuredFrontendRules: Object.keys(printConfig.rules ?? {}).length,
  helperCoverage: { path: 'script/acceptance-wasm-baseline.mjs', repositoryRuleCount: 0, reason: 'Repository flat config scopes generic rules to frontend ts/tsx only; script mjs requires explicit focused configuration' },
  scope: 'Private exact-version runtime/peer dependency links checked; actual ESLint config import and --print-config succeeded with no new CommonJS modules outside private group. Environment preflight only, not a lint pass.' };
writeFileSync(join(group, 'lint-environment-proof.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ packages: receipt.packages, links: links.length, newlyLoadedCjs: newlyLoadedCjs.length, escapedCjs: escapedCjs.length, configuredFrontendRules: receipt.configuredFrontendRules, helperRules: 0, status: receipt.status }));

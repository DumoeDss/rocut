import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const group = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/.worktrees/rocut-acceptance-20261011-6fa23f6b';
const rocut = join(group, '_others/rocut');
const require = createRequire(join(rocut, 'package.json'));
const lockPath = join(rocut, 'bun.lock');
const lockBytes = readFileSync(lockPath);
const lock = require('json5').parse(new TextDecoder('utf-8', { fatal: true }).decode(lockBytes));
const tar = require('tar');
const hash = (algorithm, bytes, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const records = new Map();
const mode = process.argv[2] ?? 'tools';
if (!['tools', 'lint'].includes(mode)) throw Error('Usage: restore-acceptance-dependencies.mjs [tools|lint]');
function privatePath(path) {
  const output = resolve(group, path), rel = relative(resolve(group), output);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error(`Outside private group: ${output}`);
  return output;
}
function link(target, output) {
  privatePath(output);
  mkdirSync(dirname(output), { recursive: true });
  let previous;
  try { previous = lstatSync(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    if (!previous.isSymbolicLink() || realpathSync(output) !== realpathSync(target)) throw Error(`Refuse replacing dependency: ${output}`);
  } else symlinkSync(target, output, 'junction');
}
function dependencyKey(parent, name) {
  let prefix = parent;
  while (prefix) {
    const candidate = `${prefix}/${name}`;
    if (lock.packages[candidate]) return candidate;
    const slash = prefix.lastIndexOf('/');
    prefix = slash < 0 ? '' : prefix.slice(0, slash);
  }
  if (!lock.packages[name]) throw Error(`No frozen dependency key: ${parent} -> ${name}`);
  return name;
}
async function restore(key) {
  if (records.has(key)) return records.get(key);
  const entry = lock.packages[key];
  if (!Array.isArray(entry) || typeof entry[0] !== 'string') throw Error(`Not a registry lock entry: ${key}`);
  const split = entry[0].lastIndexOf('@'), name = entry[0].slice(0, split), version = entry[0].slice(split + 1);
  const integrity = entry.find(value => typeof value === 'string' && value.startsWith('sha512-'));
  if (!integrity) throw Error(`Missing frozen integrity: ${key}`);
  const target = privatePath(join('.dependencies/restored-lock', `${key.replaceAll('/', '+')}@${version}`));
  const tarball = privatePath(join('.dependencies/restored-lock/tarballs', `${name.replaceAll('/', '+')}@${version}.tgz`));
  const url = `https://registry.npmjs.org/${name}/-/${name.slice(name.lastIndexOf('/') + 1)}-${version}.tgz`;
  let bytes;
  if (existsSync(tarball)) bytes = readFileSync(tarball);
  else {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error(`Registry fetch ${response.status}: ${name}@${version}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (`sha512-${hash('sha512', bytes, 'base64')}` !== integrity) throw Error(`Frozen integrity mismatch: ${key}`);
  if (!existsSync(tarball)) { mkdirSync(dirname(tarball), { recursive: true }); writeFileSync(tarball, bytes); }
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
    await tar.x({ file: tarball, cwd: target, strip: 1, strict: true, preservePaths: false,
      filter: (_path, entry) => { if (entry.type.includes('Link')) throw Error('Dependency tarball link refused'); return true; } });
  }
  if (lstatSync(target).isSymbolicLink()) throw Error('Restore target must be physical');
  const manifestBytes = readFileSync(join(target, 'package.json'));
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  if (manifest.name !== name || manifest.version !== version) throw Error(`Frozen identity mismatch: ${key}`);
  const record = { key, name, version, target, url, integrity, tarball, tarballSha256: hash('sha256', bytes), manifestSha256: hash('sha256', manifestBytes), dependencies: [] };
  records.set(key, record);
  const dependencies = { ...entry[2]?.dependencies, ...(mode === 'lint' ? entry[2]?.peerDependencies : {}) };
  // debug optionally requires this undeclared package at runtime. Config-import
  // evidence found an ancestor fallback; bind the already frozen lock version.
  if (mode === 'lint' && name === 'debug') dependencies['supports-color'] = lock.packages['supports-color'][0];
  // This Windows-only restoration needs exactly one esbuild optional platform.
  if (name === 'esbuild') dependencies['@esbuild/win32-x64'] = version;
  for (const dependency of Object.keys(dependencies)) {
    const restored = await restore(dependencyKey(key, dependency));
    const output = join(target, 'node_modules', dependency);
    link(restored.target, output);
    record.dependencies.push({ name: dependency, key: restored.key, target: restored.target, output });
  }
  console.log(JSON.stringify({ restored: `${name}@${version}`, key }));
  return record;
}
const roots = [];
const replacedProjections = [];
const priorLinks = JSON.parse(readFileSync(privatePath('dependency-links.json'), 'utf8'));
const rootNames = ['esbuild', '@next/eslint-plugin-next', ...(mode === 'lint' ? ['eslint', '@eslint/js', 'eslint-config-prettier', 'eslint-plugin-jsx-a11y', 'eslint-plugin-react', 'eslint-plugin-react-hooks', 'globals', 'typescript-eslint'] : [])];
for (const name of rootNames) {
  const record = await restore(name), output = join(rocut, 'node_modules', name);
  if (name === 'typescript-eslint' && existsSync(output) && realpathSync(output) !== realpathSync(record.target)) {
    const previous = realpathSync(output), mapping = priorLinks.mappings.find(row => row.output === output && row.name === name);
    if (!lstatSync(output).isSymbolicLink() || realpathSync(dirname(output)) !== resolve(dirname(output)) || !mapping || mapping.version !== record.version || previous !== mapping.installedRealPath)
      throw Error('Refuse unverified TypeScript ESLint projection replacement');
    unlinkSync(output); // Verified private projection only; shared target retained untouched.
    replacedProjections.push({ output, previous, target: record.target, action: 'unlink private junction only; shared target untouched' });
  }
  link(record.target, output); roots.push({ name, target: record.target, output });
}
const next = require('@next/eslint-plugin-next'), esbuild = require('esbuild');
if (esbuild.version !== '0.27.3' || !next.rules || Object.keys(next.rules).length === 0) throw Error('Restored tool load check failed');
const receipt = { version: 1, createdAt: new Date().toISOString(), lockPath, lockSha256: hash('sha256', lockBytes), roots, packages: [...records.values()],
  validation: { esbuildVersion: esbuild.version, nextRules: Object.keys(next.rules).length }, replacedProjections,
  diagnosticOptionalRequire: mode === 'lint' ? { from: 'debug', name: 'supports-color', identity: lock.packages['supports-color'][0], reason: 'Actual config-import detected undeclared optional ancestor resolution; bound frozen exact private version' } : undefined,
  mode, scope: 'Exact frozen lock identities and registry SHA512 tarball integrities. Tools mode restores esbuild + Windows optional binary and Next ESLint plugin runtime closure; lint mode additionally restores seven missing ESLint roots plus authorized TypeScript ESLint config dependency, including declared runtime and peer closures. No install scripts. All extraction and links inside private group; no original dependency writes.' };
writeFileSync(privatePath('dependency-restoration.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
const linksPath = privatePath('dependency-links.json'), links = JSON.parse(readFileSync(linksPath, 'utf8'));
links.restored = receipt;
for (const row of links.mappings) {
  const restored = roots.find(root => root.output === row.output);
  if (restored) { row.kind = 'private-restored-frozen-lock-package'; row.target = restored.target; }
}
writeFileSync(linksPath, JSON.stringify(links, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ packages: records.size, esbuildVersion: esbuild.version, nextRules: Object.keys(next.rules).length }));

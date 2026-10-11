import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const original = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia';
const group = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/.worktrees/rocut-acceptance-20261011-6fa23f6b';
const repositories = ['_others/rocut', 'elftia/elftia-plugin-creator-studio', 'elftia/elftia-plugin-rocut', 'elftia/elftia'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decoder = new TextDecoder('utf-8', { fatal: true });
function git(root, args, input) {
  const result = spawnSync('git', ['-C', root, ...args], { input, encoding: null, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw Error(`git ${args.join(' ')} failed: ${decoder.decode(result.stderr)}`);
  return result.stdout;
}
function destination(path) {
  const target = resolve(group, path);
  const rel = relative(resolve(group), target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error(`Target outside group: ${target}`);
  return target;
}
function digestFile(path) {
  if (!existsSync(path)) return { exists: false };
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Not a regular source file: ${path}`);
  const body = readFileSync(path);
  return { exists: true, bytes: body.length, sha256: sha(body) };
}
function names(root, args) { return decoder.decode(git(root, args)).split('\0').filter(Boolean); }
function sourceUntracked(path) {
  return path !== 'fixture-source.json' &&
    !/(^|\/)(node_modules|dist|target|\.artifacts|\.tmp[^/]*|release|coverage)(\/|$)/.test(path) &&
    !/\.(log|png|jpg|webm|mp4|wasm|tgz|zip|epkg)$/i.test(path) &&
    /\.(ts|tsx|js|mjs|cjs|rs|md|json|toml|yaml|yml|html|css)$/i.test(path);
}
function writeReceipt(name, value) {
  const path = destination(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8' });
}
function freeze(repo) {
  if (!repositories.includes(repo)) throw Error('Unknown repository');
  const source = join(original, repo), target = destination(repo);
  const sourceHead = decoder.decode(git(source, ['rev-parse', 'HEAD'])).trim();
  const targetHead = decoder.decode(git(target, ['rev-parse', 'HEAD'])).trim();
  if (sourceHead !== targetHead) throw Error('Source and target HEAD differ');
  const allTracked = names(source, ['diff', '--name-only', '-z', 'HEAD']);
  const allUntracked = names(source, ['ls-files', '--others', '--exclude-standard', '-z']);
  const deferred = repo === '_others/rocut' ? allTracked.filter(path => path.startsWith('rust/')) : [];
  const tracked = allTracked.filter(path => !deferred.includes(path));
  const untracked = allUntracked.filter(sourceUntracked).filter(path => !path.startsWith('rust/'));
  const excluded = allUntracked.filter(path => !untracked.includes(path));
  const paths = [...new Set([...tracked, ...untracked])].sort();
  const entries = paths.map(path => ({ path, kind: tracked.includes(path) ? 'tracked-diff' : 'regular-untracked-source', ...digestFile(join(source, path)) }));
  const fullPatch = git(source, ['diff', '--binary', 'HEAD']);
  const patch = deferred.length ? git(source, ['diff', '--binary', 'HEAD', '--', '.', ':(exclude)rust/**']) : fullPatch;
  const changedAfterCapture = entries.filter(entry => JSON.stringify(digestFile(join(source, entry.path))) !== JSON.stringify({ exists: entry.exists, ...(entry.exists ? { bytes: entry.bytes, sha256: entry.sha256 } : {}) }));
  if (changedAfterCapture.length) throw Error(`Source changed during capture: ${changedAfterCapture.map(x => x.path).join(', ')}`);
  if (patch.length) {
    git(target, ['apply', '--check', '--binary', '-'], patch);
    git(target, ['apply', '--binary', '-'], patch);
  }
  for (const entry of entries) {
    if (!entry.exists) continue;
    const output = destination(join(repo, entry.path));
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(join(source, entry.path), output);
    const actual = digestFile(output);
    if (actual.sha256 !== entry.sha256) throw Error(`Copied bytes differ: ${entry.path}`);
  }
  const after = entries.map(entry => ({ path: entry.path, ...digestFile(join(source, entry.path)) }));
  const drift = entries.filter((entry, index) => entry.sha256 !== after[index].sha256 || entry.exists !== after[index].exists);
  if (drift.length) throw Error(`Source changed during copy; freeze is incomplete: ${drift.map(x => x.path).join(', ')}`);
  const receipt = { version: 1, repository: repo, originalRoot: source, privateRoot: target, sourceHead, targetHead,
    capturedAt: new Date().toISOString(), originalPatchSha256: sha(fullPatch), appliedPatchSha256: sha(patch),
    stableBeforeAfter: true, scope: 'HEAD checkout plus enumerated raw-byte tracked/untracked overlay at capturedAt; not a claim that the live original remains unchanged afterward',
    entries, deferred: deferred.map(path => ({ path, reason: 'Parent will overlay exact 971 Rust/build input freeze bound to new WASM', ...digestFile(join(source, path)) })), excludedUntracked: excluded };
  writeReceipt(`source-freeze-${repo.replaceAll('/', '-')}.json`, receipt);
  console.log(JSON.stringify({ repository: repo, files: entries.length, deferred: deferred.length, excluded: excluded.length, stable: true }));
}
function inside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function physicalModules(root) {
  const result = [];
  const walk = (path, depth) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.name === 'node_modules') {
        if (!lstatSync(child).isSymbolicLink()) result.push(child);
        continue;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink() && depth < 5 &&
        !['.git', 'target', 'dist', '.artifacts', 'release', 'coverage', '.next', 'vendor', '.claude', '.agents'].includes(entry.name) &&
        !entry.name.startsWith('.tmp')) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return result;
}
function projectDependencies() {
  if (existsSync(destination('wasm-binding.json')) || existsSync(destination('dependency-restoration.json')))
    throw Error('Initial-only projection: finalized private WASM/restored-lock bindings exist; refuse to replace or downgrade them');
  const mappings = [], missing = [], copiedBins = [], skippedMetadata = [], workspace = [];
  const pendingWasm = destination('.dependencies/opencut-wasm-newpkg');
  mkdirSync(pendingWasm, { recursive: true });
  const workspaceByRealPath = new Map();
  for (const repo of repositories) {
    const source = join(original, repo);
    const manifests = ['package.json', ...names(source, ['ls-files', '-z']).filter(path =>
      /^(apps|packages)\/[^/]+\/package\.json$/.test(path))];
    for (const manifestPath of manifests) {
      const manifest = JSON.parse(decoder.decode(readFileSync(join(source, manifestPath))));
      if (!manifest.name) continue;
      const sourcePackage = resolve(source, dirname(manifestPath));
      const privatePackage = destination(join(repo, dirname(manifestPath)));
      workspaceByRealPath.set(sourcePackage.toLowerCase(), { name: manifest.name, target: privatePackage });
      workspace.push({ repository: repo, name: manifest.name, sourcePackage, privatePackage });
    }
  }
  const link = (target, output) => {
    mkdirSync(dirname(output), { recursive: true });
    let previous;
    try { previous = lstatSync(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      if (!previous.isSymbolicLink() || realpathSync(output).toLowerCase() !== realpathSync(target).toLowerCase())
        throw Error(`Refuse to replace an existing dependency: ${output}`);
    } else symlinkSync(target, output, 'junction');
  };
  for (const repo of repositories) {
    const source = join(original, repo);
    for (const modules of physicalModules(source)) {
      const relativeModules = relative(source, modules);
      const privateModules = destination(join(repo, relativeModules));
      mkdirSync(privateModules, { recursive: true });
      const entries = [];
      for (const entry of readdirSync(modules, { withFileTypes: true })) {
        if (entry.name === '.bin') {
          const targetBin = join(privateModules, '.bin');
          mkdirSync(targetBin, { recursive: true });
          for (const file of readdirSync(join(modules, '.bin'))) {
            const binSource = join(modules, '.bin', file), binTarget = join(targetBin, file);
            const stat = lstatSync(binSource);
            if (stat.isSymbolicLink()) {
              skippedMetadata.push({ path: binSource, reason: 'Non-Windows symlink bin shim; Windows regular cmd/ps1 shims are copied privately' });
            } else if (stat.isFile()) {
              copyFileSync(binSource, binTarget);
              copiedBins.push({ target: binTarget, sha256: digestFile(binTarget).sha256 });
            }
          }
          continue;
        }
        if (entry.name.startsWith('.')) { skippedMetadata.push({ path: join(modules, entry.name), reason: 'Package-manager store/cache/metadata not projected as a whole directory' }); continue; }
        if (entry.name.startsWith('@') && entry.isDirectory()) {
          for (const child of readdirSync(join(modules, entry.name))) entries.push(`${entry.name}/${child}`);
        } else entries.push(entry.name);
      }
      for (const name of entries) {
        const installed = join(modules, name), output = join(privateModules, name);
        if (name === 'opencut-wasm') {
          link(pendingWasm, output);
          mappings.push({ repository: repo, modules: relativeModules, name, kind: 'pending-new-wasm-fail-closed', target: pendingWasm, output });
          continue;
        }
        let actual;
        try { actual = realpathSync(installed); }
        catch (error) { missing.push({ repository: repo, modules: relativeModules, name, installed, code: error.code, reason: 'Original installed entry is already dangling; no version substitution/install performed' }); continue; }
        const stat = lstatSync(actual);
        if (!stat.isDirectory()) { skippedMetadata.push({ path: installed, reason: 'Not a package directory' }); continue; }
        const local = workspaceByRealPath.get(actual.toLowerCase());
        if (local) {
          link(local.target, output);
          mappings.push({ repository: repo, modules: relativeModules, name, kind: 'private-workspace-source', originalRealPath: actual, target: local.target, output });
          continue;
        }
        // An original workspace reference outside the declared package map must
        // never be misclassified as an immutable installed third-party package.
        const originalRepo = repositories.find(candidate => inside(join(original, candidate), actual));
        if (originalRepo && !relative(join(original, originalRepo), actual).split(sep).includes('node_modules')) {
          missing.push({ repository: repo, modules: relativeModules, name, installed, actual, reason: 'Original source path has no private workspace package; deliberately not linked' });
          continue;
        }
        const manifestFile = join(actual, 'package.json');
        if (!existsSync(manifestFile)) { missing.push({ repository: repo, modules: relativeModules, name, installed, actual, reason: 'No package version manifest; deliberately not reused' }); continue; }
        const manifestBytes = readFileSync(manifestFile), manifest = JSON.parse(decoder.decode(manifestBytes));
        const cache = destination(join('.dependencies', 'versions', repo.replaceAll('/', '-'), `${name.replaceAll('/', '+')}@${manifest.version ?? 'unversioned'}-${sha(manifestBytes).slice(0, 8)}-${sha(Buffer.from(actual.toLowerCase())).slice(0, 8)}`));
        link(actual, cache);
        link(cache, output);
        mappings.push({ repository: repo, modules: relativeModules, name, kind: 'installed-third-party-version', version: manifest.version, manifestSha256: sha(manifestBytes), installedRealPath: actual, target: cache, output });
      }
    }
  }
  const probes = [];
  for (const from of ['_others/rocut/package.json', '_others/rocut/apps/cli/package.json', '_others/rocut/packages/editor-classic/package.json', 'elftia/elftia/packages/agent-engine/package.json']) {
    const require = createRequire(destination(from));
    const wanted = from.startsWith('_others') ? ['@opencut/editor-contracts', '@opencut/editor-ports', '@opencut/editor-classic', '@opencut/editor-automation', 'opencut-wasm'] : ['@elftia/shared', '@elftia/core', '@elftia/plugin-types'];
    for (const name of wanted) {
      try {
        const resolved = require.resolve(name);
        if ((name.startsWith('@opencut') || name.startsWith('@elftia')) && !inside(group, resolved)) throw Error('Workspace package escaped to original source');
        probes.push({ from, name, resolved, privateSource: inside(group, resolved) });
      } catch (error) {
        if (String(error.message).includes('escaped')) throw error;
        probes.push({ from, name, error: error.code ?? error.message, expected: name === 'opencut-wasm' ? 'fail closed until parent provides the new package' : 'recorded resolution gap, not silently satisfied from the original source' });
      }
    }
  }
  writeReceipt('dependency-links.json', { version: 1, createdAt: new Date().toISOString(), group, workspace, mappings, missing, copiedBins, skippedMetadata,
    coverage: 'Root and every existing physical node_modules discovered under each source repository (depth <= 5, excluding named generated/cache directories); package directories are linked individually; no whole node_modules junction',
    thirdPartyBoundary: 'Installed version directories are reused read-only by convention, with manifest hashes; this is not an OS-level write-protection or a whole-package cryptographic freeze. Transitive third-party files retain their installed dependency trees.',
    probes, wasm: { state: 'pending-parent-new-package', target: pendingWasm } });
  console.log(JSON.stringify({ projections: mappings.length, missing: missing.length, bins: copiedBins.length, probes: probes.length, unresolved: probes.filter(row => row.error).length }));
}
const [mode, repo] = process.argv.slice(2);
if (mode === 'freeze') freeze(repo);
else if (mode === 'project-dependencies') projectDependencies();
else throw Error('Usage: prepare-acceptance-worktree.mjs freeze <repository> | project-dependencies');

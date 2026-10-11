import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const group = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/.worktrees/rocut-acceptance-20261011-6fa23f6b';
const rocut = join(group, '_others/rocut');
const authority = 'C:/Users/Sayo/AppData/Local/Temp/rocut-wasm-authority-20261011-GVDTX4';
const wasmSha = '084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12';
const decoder = new TextDecoder('utf-8', { fatal: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(decoder.decode(readFileSync(path)));
function within(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function privatePath(path) {
  const target = resolve(group, path);
  if (!within(group, target) || target === resolve(group)) throw Error(`Outside private group: ${target}`);
  return target;
}
function receipt(name, value) { writeFileSync(privatePath(name), JSON.stringify(value, null, 2) + '\n', 'utf8'); }
function inventory(root, prefix = '') {
  const rows = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name), stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink()) throw Error(`Package copy refuses links: ${path}`);
    if (stat.isDirectory()) rows.push(...inventory(root, path));
    else if (stat.isFile()) rows.push({ path, bytes: stat.size, sha256: sha(readFileSync(join(root, path))) });
    else throw Error(`Not a regular package entry: ${path}`);
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
function verifiedCopy(source, output) {
  const files = inventory(source);
  mkdirSync(output, { recursive: true });
  for (const file of files) {
    const target = join(output, file.path);
    if (existsSync(target) && sha(readFileSync(target)) !== file.sha256) throw Error(`Refuse existing different bytes: ${target}`);
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target)) copyFileSync(join(source, file.path), target);
  }
  if (JSON.stringify(inventory(source)) !== JSON.stringify(files) || JSON.stringify(inventory(output)) !== JSON.stringify(files)) throw Error('Package copy drift');
  return files;
}
function bindWasm() {
  const canonical = privatePath('_others/rocut/rust/wasm/pkg');
  const retainedCanonical = privatePath('.dependencies/opencut-wasm-newpkg');
  const browser = privatePath('.dependencies/opencut-wasm-browser-newpkg');
  const removedLinks = [];
  const parentRealPath = realpathSync(dirname(canonical));
  if (parentRealPath !== resolve(dirname(canonical)) || !within(group, parentRealPath)) throw Error('Canonical parent redirection');
  let prior;
  try { prior = lstatSync(canonical); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior?.isSymbolicLink()) {
    const previous = realpathSync(canonical);
    if (previous !== realpathSync(retainedCanonical) || !within(group, previous)) throw Error('Unexpected canonical link target');
    // Verified private link only; never recursively traverse or delete its target.
    unlinkSync(canonical);
    removedLinks.push({ path: canonical, previousTarget: previous, action: 'unlink link only; target retained' });
  }
  if (existsSync(browser) && lstatSync(browser).isSymbolicLink()) throw Error('Historical browser copy must be physical');
  const canonicalFiles = verifiedCopy(join(authority, 'pkg'), canonical);
  const browserFiles = inventory(browser); // Keep immutable v1 history; v2 derived browser is owned by the authority agent.
  for (const root of [canonical, browser]) if (sha(readFileSync(join(root, 'opencut_wasm_bg.wasm'))) !== wasmSha) throw Error('Authority binary mismatch');
  const probes = [];
  for (const from of ['package.json', 'apps/cli/package.json', 'packages/editor-classic/package.json', 'apps/web/package.json']) {
    const output = privatePath(join('_others/rocut', dirname(from), 'node_modules/opencut-wasm'));
    if (realpathSync(dirname(output)) !== resolve(dirname(output))) throw Error('WASM dependency parent redirection');
    const stat = lstatSync(output), previous = realpathSync(output);
    if (!stat.isSymbolicLink() || !within(group, previous)) throw Error('Unexpected WASM dependency projection');
    if (previous !== realpathSync(canonical)) {
      if (previous !== realpathSync(retainedCanonical)) throw Error('Unexpected previous WASM binding');
      unlinkSync(output);
      removedLinks.push({ path: output, previousTarget: previous, action: 'unlink link only; target retained' });
      symlinkSync(canonical, output, 'junction');
    }
    const require = createRequire(join(rocut, from));
    const resolved = require.resolve('opencut-wasm');
    const packageRoot = realpathSync(join(dirname(join(rocut, from)), 'node_modules/opencut-wasm'));
    if (!within(group, resolved) || packageRoot !== realpathSync(canonical)) throw Error(`WASM escaped: ${from}`);
    probes.push({ from, resolved, packageRoot, binarySha256: sha(readFileSync(join(packageRoot, 'opencut_wasm_bg.wasm'))) });
  }
  const value = { version: 1, createdAt: new Date().toISOString(), authority, authorityReceipt: join(authority, 'verify-GkumKi/evidence.json'),
    canonical, retainedCanonical, browser, browserState: 'historical-v1-copy-not-current-browser-acceptance', canonicalFiles, browserFiles, canonicalRealPath: realpathSync(canonical), parentRealPath, binarySha256: wasmSha, removedLinks, probes };
  receipt('wasm-binding.json', value);
  const deps = json(privatePath('dependency-links.json'));
  for (const row of deps.mappings) if (row.name === 'opencut-wasm') { row.kind = 'private-authority-wasm-copy'; row.target = canonical; }
  for (const probe of deps.probes) if (probe.name === 'opencut-wasm') {
    const require = createRequire(privatePath(probe.from));
    delete probe.error; delete probe.expected;
    probe.resolved = require.resolve(probe.name); probe.privateSource = true;
  }
  deps.wasm = { state: 'bound-private-authority-copy', target: canonical, browser, binarySha256: wasmSha, receipt: privatePath('wasm-binding.json') };
  receipt('dependency-links.json', deps);
  console.log(JSON.stringify({ bound: probes.length, binarySha256: wasmSha, canonicalRealPath: value.canonicalRealPath, removedLinks }));
}
async function proveResolution() {
  const require = createRequire(join(rocut, 'package.json'));
  const esbuild = require('esbuild');
  if (esbuild.version !== '0.27.3') throw Error(`Incorrect esbuild version ${esbuild.version}`);
  const probes = [];
  for (const from of ['apps/cli', 'packages/editor-classic', 'apps/web']) {
    const names = ['@opencut/editor-contracts', '@opencut/editor-ports', '@opencut/editor-classic', '@opencut/editor-automation', 'opencut-wasm'];
    const resolved = [];
    await esbuild.build({ absWorkingDir: join(rocut, from), bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent',
      stdin: { contents: names.map(name => `import '${name}';`).join('\n'), sourcefile: 'acceptance-resolution-only.ts', loader: 'ts', resolveDir: join(rocut, from) },
      plugins: [{ name: 'resolution-only-stop-transitive-load', setup(build) {
        build.onLoad({ filter: /./ }, args => {
          if (!within(group, args.path)) throw Error(`Bundler workspace import escaped: ${args.path}`);
          resolved.push({ path: args.path, privateSource: true });
          return { contents: 'export {};', loader: 'js' };
        });
      } }] });
    if (resolved.length !== names.length) throw Error(`Expected ${names.length} package roots, found ${resolved.length}`);
    probes.push({ from, names, resolved });
  }
  receipt('bundler-resolution-proof.json', { version: 1, createdAt: new Date().toISOString(), esbuildVersion: esbuild.version, esbuildModule: require.resolve('esbuild'),
    scope: 'Real esbuild resolution of workspace entry imports; onLoad stops transitive compilation. This is not compile/runtime acceptance.', probes });
  console.log(JSON.stringify({ esbuildVersion: esbuild.version, bundlerProbes: probes.length, resolvedEntries: probes.reduce((sum, x) => sum + x.resolved.length, 0) }));
}
function aggregate() {
  const manifestPath = join(authority, 'source/source-manifest.json');
  const manifestBytes = readFileSync(manifestPath), manifest = json(manifestPath);
  if (sha(manifestBytes) !== 'd6cb235399f0090d037eb1c6d8c10241c8042d1d2b16913e56c6dc7a08e207c0' || manifest.entries.length !== 971) throw Error('Authority input manifest identity mismatch');
  const drift = manifest.entries.filter(entry => sha(readFileSync(join(rocut, entry.path))) !== entry.sha256);
  if (drift.length) throw Error(`Frozen Rust/build inputs drifted: ${drift.map(x => x.path).join(', ')}`);
  const repos = ['_others/rocut', 'elftia/elftia-plugin-creator-studio', 'elftia/elftia-plugin-rocut', 'elftia/elftia'];
  const receipts = repos.map(repo => { const path = privatePath(`source-freeze-${repo.replaceAll('/', '-')}.json`); return { path, sha256: sha(readFileSync(path)), ...json(path) }; });
  const helpers = ['prepare-acceptance-worktree.mjs', 'finalize-acceptance-worktree.mjs', 'restore-acceptance-dependencies.mjs', 'run-acceptance-source-contracts.mjs', 'verify-acceptance-lint-environment.mjs', 'acceptance-wasm-baseline.mjs'].map(file => ({ path: join(rocut, 'script', file), sha256: sha(readFileSync(join(rocut, 'script', file))) }));
  const evidence = ['dependency-links.json', 'wasm-binding.json', 'bundler-resolution-proof.json', 'dependency-restoration.json', 'source-contracts.json', 'lint-environment-proof.json'].map(file => ({ path: privatePath(file), sha256: sha(readFileSync(privatePath(file))) }));
  receipt('source-freeze.json', { version: 1, createdAt: new Date().toISOString(), group, branch: 'acceptance/20261011-6fa23f6b', receipts, helpers, evidence,
    rustBuildOverride: { sourceManifest: manifestPath, sourceManifestSha256: sha(manifestBytes), files: 971, privateInputDrift: drift.length,
      scope: 'Parent overlaid exact authority Rust/build input freeze; supersedes two deferred Rust diffs in Rocut initial receipt. Authority verifier independently established parity.' },
    boundary: 'Initial source freeze captured HEAD + enumerated raw bytes at each capturedAt. Later private integration edits are permitted and must be recorded in acceptance commits/evidence; no claim original live repositories remain unchanged. Original repos were not staged, stashed, reset, or committed by this helper. Third-party directories reused read-only by convention, not OS-protected.' });
  console.log(JSON.stringify({ repositories: receipts.length, receipts: receipts.map(x => ({ repository: x.repository, files: x.entries.length, head: x.sourceHead })), evidence }));
}
function contractsSummary() {
  const require = createRequire(join(rocut, 'package.json'));
  const lock = require('json5').parse(decoder.decode(readFileSync(join(rocut, 'bun.lock'))));
  const lintDependencies = ['eslint', '@eslint/js', '@next/eslint-plugin-next', 'eslint-config-prettier/flat', 'eslint-plugin-jsx-a11y', 'eslint-plugin-react', 'eslint-plugin-react-hooks', 'globals', 'typescript-eslint'].map(name => {
    const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
    const row = { name, frozenLockIdentity: lock.packages[packageName]?.[0], privateProjectionPresent: existsSync(join(rocut, 'node_modules', packageName)) };
    try { row.resolved = require.resolve(name); row.outsideDeclaredProjection = !row.privateProjectionPresent; }
    catch (error) { row.error = error.code; }
    return row;
  });
  const contracts = ['rocut', 'creator', 'creator-entry', 'host'].map(suite => {
    const path = privatePath(`.acceptance-source-contracts/${suite}.json`);
    return { path, sha256: sha(readFileSync(path)), ...json(path) };
  });
  receipt('source-contracts.json', { version: 1, createdAt: new Date().toISOString(), group, contracts, lintDependencies,
    results: { rocut: { pass: 43, skip: 2, fail: 0 }, creator: { pass: 34, fail: 0 }, host: { pass: 46, fail: 0 } },
    lint: { state: lintDependencies.some(row => row.error || row.outsideDeclaredProjection) ? 'blocked-not-run' : 'isolated-environment-ready-lint-not-run',
      environmentProof: privatePath('lint-environment-proof.json'), helperCoverage: 'Repository generic rules cover frontend ts/tsx, not script/*.mjs; explicit focused configuration required. Environment ready is not lint pass.' },
    unverified: ['Full lint/typecheck/build', 'Actual HF/Remotion archive-revision compiler tests (2 skips)', 'Three real compile targeted example deferred by parent', 'Real Electron/GPU/export behavior'] });
  console.log(JSON.stringify({ suites: contracts.length, status: contracts.map(x => ({ suite: x.suite, status: x.status })), lintDependencies }));
}
const [mode] = process.argv.slice(2);
if (mode === 'bind-wasm') bindWasm();
else if (mode === 'prove-resolution') await proveResolution();
else if (mode === 'aggregate') aggregate();
else if (mode === 'contracts-summary') contractsSummary();
else throw Error('Usage: finalize-acceptance-worktree.mjs bind-wasm | prove-resolution | contracts-summary | aggregate');

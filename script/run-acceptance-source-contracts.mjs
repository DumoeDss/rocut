import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const group = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/.worktrees/rocut-acceptance-20261011-6fa23f6b';
const rocut = join(group, '_others/rocut');
const output = join(group, '.acceptance-source-contracts');
const decoder = new TextDecoder('utf-8', { fatal: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const cliTests = ['programmatic-build-revision', 'programmatic-build-files', 'programmatic-model-import', 'programmatic-model-restore', 'three-asset-features', 'three-codec-closure', 'liquid-object-electron', 'electron-native-video-server'].map(name => `apps/cli/src/__tests__/${name}.test.ts`);
const scalarTests = ['scalar-batch-resolver', 'scalar-admission', 'project-animation-admission'].map(name => `packages/editor-classic/src/animation/__tests__/${name}.test.ts`);
const suites = {
  rocut: { root: rocut, command: 'bun', args: ['test', ...cliTests, 'packages/editor-classic/src/services/renderer/compositor/wasm-compositor-ownership.test.ts', ...scalarTests],
    scope: '12 targeted build/model/asset/Electron/compositor/scalar/admission source contracts. Real resource/scalar boundary uses newly private-bound authority WASM; ownership test subprocess substitutes opencut-wasm; Electron/codec/feature IO uses contract fixtures. Two actual HF/Remotion toolchain compiles are expected skipped without explicit env opt-in. No GPU/export proof.' },
  creator: { root: join(group, 'elftia/elftia-plugin-creator-studio'), command: 'node', args: ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=1', 'src/renderer/programmatic/templates.test.ts', 'src/main/programmatic/rocut-template-catalog.test.ts', 'src/main/programmatic/ipc/__tests__/registerHtmlVideoIpc.test.ts'],
    scope: 'Three renderer/catalog/IPC source contracts. No real WASM/render.' },
  'creator-entry': { root: join(group, 'elftia/elftia-plugin-creator-studio'), command: 'node', args: ['--test', 'scripts/tests/rocut-template-entry.test.mjs'],
    scope: 'Template entry helper identity and helper/reference file existence; no real render.' },
  host: { root: join(group, 'elftia/elftia'), command: 'node', args: ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=1',
    'packages/desktop/app/main/services/platform/html-frames/__tests__/electronNativeVideo.test.ts',
    'packages/desktop/app/main/services/platform/html-frames/__tests__/liquid-session-contract.test.ts',
    'packages/desktop/app/main/services/platform/html-frames/__tests__/electronParticleCapture.test.ts',
    'packages/desktop/app/main/services/platform/tool-hosts/__tests__/validateToolHostDescriptor.test.ts'],
    scope: 'Four native-video/Liquid-session/particle/descriptor protocol source contracts with mocked Electron/CDP/HTTP; no actual Electron window, WASM, or GPU.' },
};
const [selected] = process.argv.slice(2), suite = suites[selected];
if (!suite) throw Error(`Select exactly one suite: ${Object.keys(suites).join(', ')}`);
mkdirSync(output, { recursive: true });
const wasmRoot = realpathSync(join(rocut, 'node_modules/opencut-wasm'));
const binarySha256 = sha(readFileSync(join(wasmRoot, 'opencut_wasm_bg.wasm')));
if (binarySha256 !== '084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12') throw Error('Wrong WASM binding');
const startedAt = new Date().toISOString();
const sourceInputs = suite.args.filter(arg => /\.test\.(ts|mjs)$/.test(arg)).map(path => ({ path, sha256: sha(readFileSync(join(suite.root, path))) }));
const result = spawnSync(suite.command, suite.args, { cwd: suite.root, env: { ...process.env, GOMAXPROCS: '2', NO_COLOR: '1' }, windowsHide: true, encoding: null, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
writeFileSync(join(output, `${selected}.stdout.log`), stdout);
writeFileSync(join(output, `${selected}.stderr.log`), stderr);
const text = decoder.decode(stdout) + '\n' + decoder.decode(stderr);
// ANSI escape bytes are intentional here; remove terminal color, not test content.
// eslint-disable-next-line no-control-regex
const summary = text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).filter(line => /pass|fail|skip|Test Files|Tests |error:|Error:|AssertionError|Duration|no tests found/i.test(line));
const privateSourceDrift = sourceInputs.filter(row => sha(readFileSync(join(suite.root, row.path))) !== row.sha256);
const runner = suite.command === 'node' && suite.args[0].includes('vitest') ? createRequire(join(suite.root, 'package.json')).resolve('vitest/package.json') : suite.command;
const receipt = { version: 1, suite: selected, privateRoot: suite.root, command: [suite.command, ...suite.args], startedAt, finishedAt: new Date().toISOString(), status: result.status, signal: result.signal,
  error: result.error ? { name: result.error.name, code: result.error.code, message: result.error.message } : undefined, runner, binarySha256, wasmRoot, scope: suite.scope,
  sourceInputs, privateSourceDrift, stdoutSha256: sha(stdout), stderrSha256: sha(stderr), summary,
  logs: { stdout: join(output, `${selected}.stdout.log`), stderr: join(output, `${selected}.stderr.log`) } };
writeFileSync(join(output, `${selected}.json`), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(receipt, null, 2));
process.exitCode = result.status === 0 && !privateSourceDrift.length ? 0 : 1;

import { strict as assert } from 'node:assert';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, createServer } from './browser-probe-toolchain.mjs';
import { buildNativeAudioExportProbe } from './native-audio-export-build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [scaffold, toolchain, styles, assets] = process.argv.slice(2);
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (![scaffold, toolchain, styles, assets, isolated, ffmpeg, ffprobe].every(value => value && isAbsolute(value)))
  throw Error('Provide absolute scaffold/toolchain/style-toolchain/asset-directory arguments and WASM/FFmpeg/FFprobe environment paths');
const temporary = await mkdtemp(join(tmpdir(), 'rocut-remotion-presets-'));
console.log(JSON.stringify({ artifacts: temporary }));
const host = spawn('bun', ['--preload', './script/fixtures/isolated-web-wasm-preload.mjs',
  'script/fixtures/remotion-presets-host.ts', scaffold, toolchain, styles, assets, temporary], {
  cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary },
});
const exited = new Promise(resolve => host.once('close', resolve));
let browser, server, ready = false;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Preset native validation startup timeout')), 900000);
    const fail = error => { clearTimeout(timer); reject(error); };
    host.once('error', fail); host.once('exit', code => fail(Error(`Preset fixture exited ${code}`)));
    host.stderr.on('data', data => process.stderr.write(data));
    host.stdout.on('data', data => {
      process.stdout.write(data); output += String(data); let end;
      while ((end = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, end); output = output.slice(end + 1);
        try { const value = JSON.parse(line); if (value.endpoint) { clearTimeout(timer); resolve(value.endpoint); } } catch {}
      }
    });
  });
  ready = true;
  // All native browser captures have finished before the export browser starts.
  const output = join(temporary, 'web');
  await buildNativeAudioExportProbe(root, isolated, output, 'remotion-presets-browser');
  server = await createServer({ root: output, configFile: false, logLevel: 'error', cacheDir: join(temporary, 'vite-cache'),
    optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', hmr: false, port: 0, proxy: { '/api': { target: endpoint } } } });
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/remotion-presets-browser.html`, { waitUntil: 'commit' });
  await page.waitForFunction(() => globalThis.__remotionPresets, undefined, { timeout: 180000 });
  const result = await page.evaluate(() => globalThis.__remotionPresets);
  if (result.error || errors.length) throw Error(JSON.stringify({ result, errors }));
  await browser.close(); browser = undefined;
  const native = JSON.parse(await readFile(join(temporary, 'native-results.json'), 'utf8'));
  const matrix = [];
  for (const video of result.videos) {
    const entry = native.results.find(item => item.id === video.id);
    const file = join(temporary, video.id, 'rocut.webm'); await writeFile(file, Buffer.from(video.bytes));
    const options = { windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 };
    const metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file], options));
    const stream = metadata.streams.find(item => item.codec_type === 'video');
    assert.equal(Number(stream.nb_read_frames), 3); assert.equal(stream.width, entry.source.width); assert.equal(stream.height, entry.source.height);
    const actual = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], options);
    let difference = 0, count = 0, opaque = 0, nonblack = 0;
    const pixels = entry.source.width * entry.source.height;
    for (let frame = 0; frame < 3; frame++) {
      const expected = execFileSync(ffmpeg, ['-v', 'error', '-i', join(temporary, video.id, 'frames', `${entry.firstFrame + frame}.png`),
        '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], options);
      assert.equal(expected.length, pixels * 4);
      for (let pixel = 0; pixel < pixels; pixel += 17) {
        const alpha = expected[pixel * 4 + 3] / 255;
        if (alpha > 0.99) opaque++;
        for (let channel = 0; channel < 3; channel++) {
          const reference = expected[pixel * 4 + channel] * alpha;
          difference += Math.abs(reference - actual[(frame * pixels + pixel) * 3 + channel]); count++;
          if (reference > 32) nonblack++;
        }
      }
    }
    const meanAbsoluteError = difference / count;
    assert.ok(opaque > 100 && nonblack > 100, `${video.id}: blank picture`);
    assert.ok(meanAbsoluteError < 8, `${video.id}: exported picture mismatch ${meanAbsoluteError}`);
    matrix.push({ id: video.id, compile: true, randomFrames: entry.randomFrames,
      repeatPixelsExact: entry.repeatPixelsExact, rebuiltPixelsExact: entry.rebuiltPixelsExact,
      archiveRebuilt: true, exportedFrames: 3, width: stream.width, height: stream.height, meanAbsoluteError, exportedBytes: video.bytes.length });
  }
  await writeFile(join(temporary, 'verification.json'), JSON.stringify({ matrix, errors: native.errors }, null, 2));
  console.log(JSON.stringify({ matrix, errors: native.errors, scope: 'Original presets -> native Remotion/Rocut PNG -> ProgrammaticNode/buildScene -> SceneExporter -> independent video decode; standalone, not installed Electron' }, null, 2));
  assert.equal(matrix.length, process.env.ROCUT_TEST_PRESETS?.split(',').length ?? 6, 'Not all requested original presets passed');
  assert.equal(native.errors.length, 0, 'Native raster consistency is unresolved; export success does not waive this gate');
} catch (error) { console.error(error?.stack ?? String(error)); process.exitCode = 1; }
finally {
  await browser?.close(); await server?.close();
  if (host.exitCode === null && !host.killed) { if (ready) host.stdin.end('stop\n'); else host.kill(); }
  await exited;
  if (process.env.ROCUT_PRESETS_KEEP_DIAGNOSTIC !== '1') {
    if (dirname(temporary) !== resolve(tmpdir()) || !basename(temporary).startsWith('rocut-remotion-presets-')) throw Error('Unsafe preset probe cleanup');
    await rm(temporary, { recursive: true, force: true });
  }
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { join, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function imageBytes(width, height) {
  const rows = Buffer.alloc(height * (width * 4 + 1));
  let cutout = 0, hole = 0, opaque = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const body = ((x - width * .5) / (width * .39)) ** 2 + ((y - height * .53) / (height * .4)) ** 2 < 1;
    const opening = ((x - width * .48) / (width * .12)) ** 2 + ((y - height * .5) / (height * .14)) ** 2 < 1;
    const alpha = body && !opening ? 255 : 0;
    rows.set([220, 95 + x % 90, 40 + y % 90, alpha], y * (width * 4 + 1) + x * 4 + 1);
    if (alpha) opaque++; else if (opening) hole++; else cutout++;
  }
  assert(cutout > 0 && hole > 0 && opaque > 0);
  function chunk(type, bytes) {
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([Buffer.from(type), bytes])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const head = Buffer.alloc(4), tail = Buffer.alloc(4);
    head.writeUInt32BE(bytes.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([head, Buffer.from(type), bytes, tail]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return { bytes: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]),
    alphaFixture: { width, height, opaque, hole, cutout, shape: "elliptical nonrectangular cutout with interior elliptical hole" } };
}

export async function run({ startHost, TargetRegistry, root, creator, configPath }) {
  const privatePath = async (path) => {
    const resolved = await realpath(path), relative = win32.relative('C:/tmps', resolved);
    assert(relative && !relative.startsWith('..') && !win32.isAbsolute(relative)); return resolved;
  };
  await privatePath(root); await privatePath(configPath);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (config.editorDist) await privatePath(config.editorDist);
  const manifest = JSON.parse(await readFile(join(root, 'editor-closure.json'), 'utf8'));
  const pin = async () => { for (const f of [...manifest.files, ...manifest.pinned]) assert.equal(sha(await readFile(f.path)), f.sha256, f.path); };
  await pin();
  const command = new Promise((done) => {
    let input = '';
    process.stdin.on('data', (bytes) => { input += bytes.toString(); if (input.includes('\n')) done(input.split(/\r?\n/)[0].trim()); });
    process.stdin.once('end', () => done(input.trim() || 'stop'));
  });
  const { flameWrapImage } = await import(pathToFileURL(creator).href);
  const projectRoot = join(root, 'project'), lifecycle = { hostClosed: false, reopened: false, ready: false,
    verified: false, error: undefined, browserTested: false, gpuTested: false, exportTested: false };
  const options = { projectRoot, staticDir: config.editorDist, port: 0,
    registry: new TargetRegistry(join(root, 'registry')), htmlBrowserExecutable: '', htmlFrameConnectionFile: '' };
  let host;
  const open = async () => { host = await startHost(options); };
  const close = async () => { if (host) { await host.close(); host = undefined; } };
  const save = (name, value) => writeFile(join(root, name), Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2), { flag: 'wx' });
  const request = async (route, body) => {
    const response = await fetch(new URL(`api/${route}`, host.editorUrl), { signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
  };
  const snapshot = async () => {
    const context = await request('context'), byId = (a, b) => a.id.localeCompare(b.id);
    return { project: context.project, revision: context.revision, clips: (await request('clips')).sort(byId), tracks: (await request('tracks')).sort(byId) };
  };
  const disk = () => readFile(join(projectRoot, 'project.json'));
  try {
    await open();
    const catalog = await request('editing/catalog'), fields = catalog.effects['flame-wrap'];
    assert.equal(fields.length, 9); assert.equal(fields.filter((f) => f.keyframable).length, 7);
    const author = join(root, 'author'); await mkdir(author);
    const png = imageBytes(192, 128), filePath = join(author, 'cutout-hole.png');
    await writeFile(filePath, png.bytes, { flag: 'wx' });
    const { resource } = await request('programmatic/resources/import', { id: 'cutout-hole.png', kind: 'image', filePath, mimeType: 'image/png' });
    assert.equal(resource.sha256, sha(png.bytes));
    const settings = { width: 192, height: 128, durationFrames: 24, frameRate: { numerator: 24, denominator: 1 } };
    const staticShot = flameWrapImage({ image: resource, settings });
    const animatedShot = flameWrapImage({ image: resource, settings, keyframes: Object.fromEntries(fields.filter((f) => f.keyframable)
      .map((f) => [f.key, [{ time: 17, value: f.min }, { time: 119999, value: f.max }]])) });
    const clips = [staticShot, animatedShot, staticShot].map((shot, index) => {
      const effects = structuredClone(shot.effects); if (index === 2) effects[0].enabled = false;
      return { id: ['flame-static', 'flame-animated', 'flame-disabled'][index], trackId: 'flame-shots', startTime: index * 120000,
        duration: 120000, trimStart: 0, trimEnd: 0, editing: { type: 'graphic', name: ['Static', 'Seven animated', 'Disabled'][index],
          definitionId: 'programmatic', params: {}, programmatic: shot.source, effects, animations: shot.animations } };
    });
    const context = await request('context');
    const applied = await request('apply', { expectedRevision: context.revision, operations: [
      { kind: 'update-project', projectId: context.project.id, patch: { name: 'Flame Wrap editor short cutout', canvasWidth: 192, canvasHeight: 128, frameRate: settings.frameRate } },
      { kind: 'create-track', track: { id: 'flame-shots', name: 'Flame Wrap', kind: 'graphic', hidden: false } },
      ...clips.map((clip) => ({ kind: 'create-clip', clip }))] });
    assert.equal(applied.accepted, true);
    const prepared = await snapshot(), bytes = await disk(); assert.equal(prepared.revision, context.revision + 1);
    for (const c of clips) assert.deepEqual(prepared.clips.find((f) => f.id === c.id).editing, c.editing);
    await close(); await open(); assert.deepEqual(await snapshot(), prepared); assert.deepEqual(await disk(), bytes);
    lifecycle.reopened = true;
    await save('prepared.json', { snapshot: prepared, resource, alphaFixture: png.alphaFixture, source: staticShot.source, editorDist: config.editorDist || null });
    await save('project-before-editor.json', bytes);
    lifecycle.ready = true;
    console.log(JSON.stringify({ ready: true, editorUrl: host.editorUrl, root }));
    const action = await command; process.stdin.pause();
    assert(['stop', 'verify'].includes(action), 'Expected stdin stop or verify');
    if (action === 'verify') {
      const current = await snapshot(), persisted = await disk();
      const expected = config.expectedFile ? JSON.parse(await readFile(config.expectedFile, 'utf8')) : prepared;
      assert.deepEqual(current, expected);
      for (const c of current.clips) {
        const effect = c.editing.effects[0]; assert.equal(effect.type, 'flame-wrap');
        assert.deepEqual(Object.keys(effect.params).sort(), fields.map((f) => f.key).sort());
      }
      await close(); await open(); assert.deepEqual(await snapshot(), current); assert.deepEqual(await disk(), persisted);
      await save('project-after-reopen.json', persisted); await save('verified.json', { snapshot: current, projectSha256: sha(persisted), byteIdentical: true });
      lifecycle.verified = true;
    }
  } catch (error) { lifecycle.error = error.message; throw error; }
  finally { try { await close(); lifecycle.hostClosed = true; await pin(); } finally { await save('host-lifecycle.json', lifecycle); } }
}

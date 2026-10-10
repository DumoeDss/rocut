import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function run({ startHost, TargetRegistry, root, creator }) {
  const { flameWrapImage } = await import(pathToFileURL(creator).href);
  assert.equal(typeof flameWrapImage, "function");
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const projectRoot = join(root, "project");
  const options = { projectRoot, registry: new TargetRegistry(join(root, "registry")), port: 0,
    htmlBrowserExecutable: "", htmlFrameConnectionFile: "" };
  const evidence = { ok: false, hostClosed: false, reopens: [], rejected: [], admissionGaps: [], requests: [],
    transport: "Real startHost HTTP editing and FileProjectStore; real Creator flameWrapImage",
    gpuTested: false, browserTested: false, exportTested: false,
    perFrameWorkBudgetTested: false, perFrameWorkBudgetGate: "GPU uniform admission requires frame execution; HTTP editing persistence alone cannot establish it" };
  let host;
  const open = async () => { host = await startHost(options); assert(host.port > 0); };
  const close = async () => { if (host) { await host.close(); host = undefined; } };
  const raw = async (route, body) => {
    const response = await fetch(new URL(`api/${route}`, host.editorUrl), {
      signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const json = route.endsWith("/load") ? undefined : JSON.parse(bytes.toString("utf8"));
    evidence.requests.push({ route, status: response.status, body, response: json,
      responseSha256: sha(bytes) });
    return { status: response.status, bytes, json };
  };
  const request = async (route, body) => {
    const result = await raw(route, body); assert.equal(result.status, 200, JSON.stringify(result.json)); return result.json;
  };
  const snapshot = async () => {
    const current = await request("context");
    const byId = (a, b) => a.id.localeCompare(b.id);
    return { context: { project: current.project, revision: current.revision },
      clips: (await request("clips")).sort(byId), tracks: (await request("tracks")).sort(byId) };
  };
  const disk = () => readFile(join(projectRoot, "project.json"));
  const accept = async (operations) => {
    const context = await request("context"), result = await request("apply", { expectedRevision: context.revision, operations });
    assert.equal(result.accepted, true); assert.equal((await request("context")).revision, context.revision + 1);
  };
  const reopen = async (label) => {
    const before = await snapshot(), bytes = await disk(); await close(); await open();
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await disk(), bytes);
    evidence.reopens.push({ label, revision: before.context.revision, projectSha256: sha(bytes) });
  };
  try {
    await open();
    const catalog = await request("editing/catalog"), fields = catalog.effects['flame-wrap'];
    assert(Array.isArray(fields)); assert.equal(fields.length, 9);
    assert.deepEqual(fields.filter((f) => !f.keyframable).map((f) => f.key).sort(), ['seed', 'speed']);
    const author = join(root, "author"); await mkdir(author);
    const filePath = join(author, "flame.png");
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64');
    await writeFile(filePath, png, { flag: "wx" });
    const { resource } = await request("programmatic/resources/import", { id: "flame.png", filePath, kind: "image", mimeType: "image/png" });
    assert.equal(resource.sha256, sha(png));
    const settings = { width: 640, height: 360, durationFrames: 60, frameRate: { numerator: 30, denominator: 1 } };
    const staticShot = flameWrapImage({ image: resource, settings });
    const keys = fields.filter((f) => f.keyframable);
    const animatedShot = flameWrapImage({ image: resource, settings, params: { boundaryWidth: 8.125 },
      keyframes: Object.fromEntries(keys.map((f) => [f.key, [{ time: 17, value: f.min }, { time: 120001, value: f.max }]])) });
    const clips = [staticShot, animatedShot, staticShot].map((shot, index) => ({
      id: `flame-${index}`, trackId: "shots", startTime: index * 240000, duration: 240000, trimStart: 0, trimEnd: 0,
      editing: { type: "graphic", name: `flame-${index}`, definitionId: "programmatic", params: {},
        programmatic: shot.source, effects: index === 2 ? [] : shot.effects, animations: index === 2 ? {} : shot.animations } }));
    const context = await request("context");
    await accept([{ kind: "update-project", projectId: context.project.id, patch: {
      name: "Flame Wrap real Host private probe", canvasWidth: 640, canvasHeight: 360, frameRate: settings.frameRate } },
      { kind: "create-track", track: { id: "shots", name: "shots", kind: "graphic", hidden: false } },
      ...clips.map((clip) => ({ kind: "create-clip", clip }))]);
    for (const clip of clips) assert.deepEqual((await request("clips")).find((c) => c.id === clip.id).editing, clip.editing);
    const loaded = await raw("programmatic/resources/load", resource); assert.equal(loaded.status, 200); assert.deepEqual(loaded.bytes, png);
    await rename(author, join(root, "unavailable-author"));
    await reopen("static-nine-and-seven-animated-author-moved");
    assert.deepEqual((await raw("programmatic/resources/load", resource)).bytes, png);
    const reject = async (label, mutate) => {
      const before = await snapshot(), bytes = await disk(), editing = structuredClone(clips[1].editing);
      mutate(editing);
      const response = await raw("apply", { expectedRevision: before.context.revision, operations: [
        { kind: "update-clip", clipId: clips[2].id, patch: { editing: { ...clips[2].editing, name: `Must rollback ${label}` } } },
        { kind: "update-clip", clipId: clips[1].id, patch: { editing } } ] });
      if (response.status === 200 && response.json.accepted === true) {
        evidence.admissionGaps.push({ label, status: response.status, accepted: true,
          projectSha256Before: sha(bytes), projectSha256After: sha(await disk()) });
        await accept([clips[2], clips[1]].map((clip) => ({ kind: "update-clip", clipId: clip.id, patch: { editing: clip.editing } })));
        return;
      }
      assert.equal(response.status, 409, label); assert.equal(response.json.accepted, false, label);
      assert.deepEqual(await snapshot(), before, label); assert.deepEqual(await disk(), bytes, label);
      evidence.rejected.push({ label, revision: before.context.revision, projectSha256: sha(bytes), memoryUnchanged: true, diskUnchanged: true });
    };
    for (const field of fields) await reject(`range-${field.key}`, (e) => { e.effects[0].params[field.key] = field.max + 1; });
    await reject("fractional-seed", (e) => { e.effects[0].params.seed = 0.5; });
    await reject("unknown-field", (e) => { e.effects[0].params.unknown = 1; });
    await reject("wrong-type", (e) => { e.effects[0].params.amount = '1'; });
    for (const key of ['speed', 'seed']) await reject(`static-animation-${key}`, (e) => {
      e.animations[`effects.template-flame-wrap.params.${key}`] = { keys: [
        { id: `${key}-0`, time: 17, value: 0, segmentToNext: "linear", tangentMode: "auto" },
        { id: `${key}-1`, time: 120001, value: 1, segmentToNext: "linear", tangentMode: "auto" }] };
    });
    await reject("animated-out-of-range", (e) => { e.animations['effects.template-flame-wrap.params.boundaryWidth'].keys[1].value = 33; });
    await accept([{ kind: "update-clip", clipId: clips[0].id, patch: { editing: { ...clips[0].editing, name: "Recovered valid mutation" } } }]);
    await reopen("after-atomic-rejections-and-recovery");
    evidence.catalog = fields; evidence.animationChannels = keys.map((f) => f.key);
    assert.equal(evidence.admissionGaps.length, 0, `Host admitted invalid DTOs: ${evidence.admissionGaps.map((g) => g.label).join(', ')}`);
    evidence.ok = true;
  } catch (error) { evidence.error = error.message; throw error; }
  finally {
    await close(); evidence.hostClosed = true;
    await writeFile(join(root, "evidence.json"), JSON.stringify(evidence, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ ok: evidence.ok, reopens: evidence.reopens.length, rejected: evidence.rejected.length,
      perFrameWorkBudgetTested: false, root }));
  }
}

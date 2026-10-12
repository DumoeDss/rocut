import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import type { ResolvedTarget } from "../../apps/cli/src/target-registry";
import { runAgentCli } from "../../apps/cli/src/agent-cli";
import { particlePoseGlb } from "./particle-input-resources";

export async function runAnimationInspectHttp(root: string) {
  const host = await startHost({ projectRoot: join(root, "project"), registry: new TargetRegistry(join(root, "registry")), htmlBrowserExecutable: "", htmlFrameConnectionFile: "" });
  const request = async (route: string, input?: unknown, base = host.editorUrl) => {
    const response = await fetch(new URL(`api/${route}`, base), { signal: AbortSignal.timeout(20000), ...(input === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }) });
    const text = await response.text();
    return { status: response.status, body: response.status === 401 ? text : JSON.parse(text) };
  };
  const pins = async (directory: string): Promise<Record<string, string>> => {
    const result: Record<string, string> = {};
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isDirectory()) for (const [key, hash] of Object.entries(await pins(join(directory, item.name)))) result[`${item.name}/${key}`] = hash;
      else result[item.name] = createHash("sha256").update(await readFile(join(directory, item.name))).digest("hex");
    }
    return result;
  };
  try {
    const context = await request("context");
    assert.equal(context.body.programmaticAnimationInspect.requiredExport, "loadModelAnimationCatalog");
    const modelPath = join(root, "pose.glb");
    await writeFile(modelPath, particlePoseGlb(), { flag: "wx" });
    const imported = await request("programmatic/resources/import", { id: "pose.glb", kind: "model", mimeType: "model/gltf-binary", filePath: modelPath });
    assert.equal(imported.status, 200);
    const before = await pins(join(root, "project")), revision = (await request("context")).body.revision;
    const spec = { resource: imported.body.resource, toolchainDirectory: join(root, "toolchain") };
    const catalog = await request("programmatic/animation-inspect", spec);
    assert.equal(catalog.status, 200, JSON.stringify(catalog));
    assert.equal(catalog.body.clips[0].name, "pose");
    assert.equal(catalog.body.clips[0].duration, 1);
    assert.deepEqual(catalog.body.clips[0].tracks.map((track: { targetCategory: string }) => track.targetCategory), ["node-transform", "bone-transform", "morph"]);
    const specPath = join(root, "inspect-spec.json");
    await writeFile(specPath, JSON.stringify(spec), { flag: "wx" });
    const url = new URL(host.editorUrl);
    const resolved = { secret: { port: Number(url.port), token: url.pathname.split("/")[1] } } as ResolvedTarget;
    const originalWrite = process.stdout.write;
    let printed = "";
    try {
      process.stdout.write = ((chunk: unknown) => { printed += String(chunk); return true; }) as typeof process.stdout.write;
      await runAgentCli({ command: "programmatic", positional: ["animation-inspect", specPath], resolved });
    } finally { process.stdout.write = originalWrite; }
    assert.deepEqual(JSON.parse(printed), catalog.body);
    const missing = await request("programmatic/animation-inspect", { ...spec, resource: { ...spec.resource, attachmentKey: `programmatic-sha256-${"1".repeat(64)}`, sha256: "1".repeat(64) } });
    assert.equal(missing.status, 422);
    const old = await request("programmatic/animation-inspect", { ...spec, toolchainDirectory: "C:/tmps/rocut-three-pinned-features-ZvqmB9/toolchain" });
    assert.equal(old.status, 422);
    const badBase = host.editorUrl.replace(/\/[^/]+\/$/, "/wrong-token/");
    assert.equal((await request("programmatic/animation-inspect", spec, badBase)).status, 401);
    assert.equal((await request("context")).body.revision, revision);
    assert.deepEqual(await pins(join(root, "project")), before);
    await writeFile(join(root, "receipt.json"), JSON.stringify({ ok: true, catalog: catalog.body, cliActualAuthenticatedHost: true, missing, old, revisionUnchanged: true, projectFilesUnchanged: true, browser: false, authorExecution: false }, null, 2), { flag: "wx" });
  } finally { await host.close(); await writeFile(join(root, "cleanup.json"), JSON.stringify({ hostClosed: true }), { flag: "wx" }); }
}

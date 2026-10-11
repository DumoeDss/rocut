import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { inspectRemotionProject } from "../programmatic/remotion-inspection-project";
import { ELECTRON_NATIVE_AUDIO_PROTOCOL } from "../programmatic/electron-audio-transport";
import { ELECTRON_AUDIO_SESSION_PROTOCOL } from "../programmatic/electron-audio-session";
import { REMOTION_TOOLCHAIN } from "../programmatic/engines/engine-versions";

async function fixture() {
  const parent = "C:/tmps", root = await mkdtemp(join(parent, "rocut-electron-inspection-"));
  const toolchain = join(root, "toolchain"), author = join(root, "author"), connectionFile = join(root, "connection.json");
  await mkdir(author);
  // Private compiler fixture exercises archive/compiler/session wiring. It is
  // deliberately not a real Remotion runtime or browser-execution acceptance.
  const packages: Record<string, unknown> = {};
  for (const [name, version] of Object.entries(REMOTION_TOOLCHAIN)) {
    const directory = join(toolchain, "node_modules", name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({ name, version }), "utf8");
    packages[`node_modules/${name}`] = { version, integrity: "sha512-YQ==" };
  }
  await writeFile(join(toolchain, "package-lock.json"), JSON.stringify({ packages }), "utf8");
  await mkdir(join(toolchain, "node_modules/esbuild/lib"));
  await writeFile(join(toolchain, "node_modules/esbuild/lib/main.js"), `exports.build=async options=>({
    outputFiles:[{path:'bundle.js',text:await require('node:fs/promises').readFile(require('node:path').join(options.stdin.resolveDir,'index.tsx'),'utf8')}],
    metafile:{inputs:{}}
  });`, "utf8");
  await writeFile(join(author, "index.tsx"), `/*fixture-start*/
window.calculateMetadata=async ({props})=>{await new Promise(resolve=>setTimeout(resolve,1));return {
width:props.width,height:96,fps:30,durationFrames:props.duration,props:{...props,derived:'resolved'}};};
/*fixture-end*/`, "utf8");
  const token = "a".repeat(64), id = "b".repeat(64);
  const state = { opens: 0, evaluations: 0, closes: 0, changed: false, reject: false,
    hold: undefined as Promise<void> | undefined, entered: undefined as (() => void) | undefined };
  const server = createServer((request, response) => {
    void (async () => {
      expect(request.headers.authorization).toBe(`Bearer ${token}`);
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      let reply: object;
      if (request.url === "/v1/audio-sessions/open") {
        state.opens++; expect(input.profile).toBe("source"); expect(input.nativeVideo).toBeUndefined();
        reply = { version: 1, sessionId: id, epoch: "c".repeat(32),
          browser: { product: "fixture", revision: "1", jsVersion: "1", protocolVersion: "1" } };
      } else if (request.url === `/v1/audio-sessions/${id}/evaluate`) {
        state.evaluations++;
        state.entered?.(); if (state.hold) await state.hold;
        expect(input.expression).toContain("iframe.sandbox='allow-scripts'");
        expect(input.expression).toContain("connect-src data:");
        const documentMatch = /iframe.srcdoc=(.*);document.body.appendChild\(iframe\);/.exec(input.expression);
        if (!documentMatch) throw Error("Missing isolated inspection document");
        const document = JSON.parse(documentMatch[1]);
        const spec = JSON.parse(/window.__rocutRemotionSpec=(.*?);/.exec(document)![1]);
        const code = /\/\*fixture-start\*\/([\s\S]*?)\/\*fixture-end\*\//.exec(document)![1];
        const realm = { window: {} as { calculateMetadata: (input: unknown) => Promise<Record<string, unknown>> }, setTimeout };
        runInNewContext(code, realm);
        const metadata = await realm.window.calculateMetadata({ props: spec.inputProps });
        if (state.changed) metadata.width = 128;
        reply = state.reject ? { version: 1, value: { malformed: true } }
          : { version: 1, value: [{ id: "Calculated", ...metadata }] };
      } else if (request.url === `/v1/audio-sessions/${id}/close`) {
        state.closes++; reply = { version: 1, closed: true };
      } else throw Error("Unexpected browser API route");
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const descriptor = { version: 1, backend: "elftia-electron", token,
    endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/frame`, capabilities: {
      nativeAudioAnalysis: { version: 1, protocol: ELECTRON_NATIVE_AUDIO_PROTOCOL },
      nativeAudioSession: { version: 1, protocol: ELECTRON_AUDIO_SESSION_PROTOCOL },
    } };
  await writeFile(connectionFile, JSON.stringify(descriptor), "utf8");
  const input = { version: 1, sourceDirectory: author, entryFile: "index.tsx", files: ["index.tsx"], seed: 7,
    inputProps: { width: 80, duration: 90, label: "input" } };
  return { root, author, toolchain, connectionFile, descriptor, input, state,
    async dispose() {
      const closed = new Promise<void>(resolveClose => server.close(() => resolveClose()));
      server.closeAllConnections(); await closed;
      if (dirname(resolve(root)) !== resolve(parent)) throw Error("Unsafe inspection fixture cleanup");
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("Electron inspection authenticates source sessions, returns dynamic metadata and consumes one immutable receipt through real Host routes", async () => {
  const f = await fixture();
  const host = await startHost({ projectRoot: join(f.root, "project"), registry: new TargetRegistry(join(f.root, "registry")),
    engineToolchainDirectory: f.toolchain, htmlBrowserExecutable: "", htmlFrameConnectionFile: f.connectionFile });
  const post = (action: string, input: unknown) => fetch(new URL(`api/programmatic/build/${action}`, host.editorUrl),
    { method: "POST", body: JSON.stringify(input) });
  try {
    const capability = (await (await fetch(new URL("api/context", host.editorUrl))).json()).programmaticBuilds.remotionInspection;
    expect(capability).toMatchObject({ configured: true, backend: "elftia-electron-source-session",
      requiredProtocol: ELECTRON_AUDIO_SESSION_PROTOCOL });
    const recordBefore = await readFile(join(f.root, "project/project.json"), "utf8");
    const response = await post("inspect", f.input), receipt = await response.json();
    expect(response.status).toBe(200); expect(receipt.compositions[0]).toMatchObject({ id: "Calculated", width: 80,
      height: 96, durationFrames: 90, props: { width: 80, duration: 90, label: "input", derived: "resolved" } });
    expect(f.state).toMatchObject({ opens: 1, evaluations: 1, closes: 1 });
    expect(await readFile(join(f.root, "project/project.json"), "utf8")).toBe(recordBefore);
    await rm(join(f.author, "index.tsx"));
    const selection = { revision: receipt.revision, compositionId: "Calculated", frameRate: { numerator: 30, denominator: 1 } };
    const compiledResponse = await post("compile-inspected", selection), compiled = await compiledResponse.json();
    expect(compiledResponse.status).toBe(200); expect(compiled.source).toMatchObject({ width: 80, height: 96, durationFrames: 90 });
    expect(compiled.metadataStability).toContain("rechecked-before-compile");
    expect(f.state).toMatchObject({ opens: 2, evaluations: 2, closes: 2 });
    expect((await post("compile-inspected", selection)).status).toBe(422);
    expect(f.state.opens).toBe(2);
    expect(await readFile(join(f.root, "project/project.json"), "utf8")).toBe(recordBefore);
  } finally { await host.close(); await f.dispose(); }
});

test("legacy Electron grants reject inspection before project/toolchain reads, without a standalone fallback", async () => {
  const f = await fixture();
  try {
    await writeFile(f.connectionFile, JSON.stringify({ ...f.descriptor, capabilities: {
      nativeAudioAnalysis: f.descriptor.capabilities.nativeAudioAnalysis,
    } }), "utf8");
    await expect(inspectRemotionProject({ input: {}, toolchainDirectory: join(f.root, "missing"),
      executable: join(f.root, "must-not-launch.exe"), connectionFile: f.connectionFile,
      signal: new AbortController().signal })).rejects.toThrow("session grant");
    const host = await startHost({ projectRoot: join(f.root, "project"), registry: new TargetRegistry(join(f.root, "registry")),
      engineToolchainDirectory: join(f.root, "missing"), htmlBrowserExecutable: join(f.root, "must-not-launch.exe"),
      htmlFrameConnectionFile: f.connectionFile });
    try {
      const capability = (await (await fetch(new URL("api/context", host.editorUrl))).json()).programmaticBuilds.remotionInspection;
      expect(capability.configured).toBe(false);
      for (const action of ["inspect", "compile-inspected"]) {
        const response = await fetch(new URL(`api/programmatic/build/${action}`, host.editorUrl), { method: "POST", body: "{}" });
        expect(response.status).toBe(503); expect(await response.text()).toContain("session grant");
      }
      expect(f.state.opens).toBe(0);
    } finally { await host.close(); }
  } finally { await f.dispose(); }
});

test("metadata drift and malformed results close each Electron session and invalidate the snapshot", async () => {
  const f = await fixture();
  const host = await startHost({ projectRoot: join(f.root, "project"), registry: new TargetRegistry(join(f.root, "registry")),
    engineToolchainDirectory: f.toolchain, htmlBrowserExecutable: "", htmlFrameConnectionFile: f.connectionFile });
  const post = (action: string, input: unknown) => fetch(new URL(`api/programmatic/build/${action}`, host.editorUrl),
    { method: "POST", body: JSON.stringify(input) });
  try {
    const receipt = await (await post("inspect", f.input)).json();
    f.state.changed = true;
    const selected = { revision: receipt.revision, compositionId: "Calculated", frameRate: { numerator: 30, denominator: 1 } };
    const drift = await post("compile-inspected", selected);
    expect(drift.status).toBe(422); expect(await drift.text()).toContain("changed");
    expect(f.state.closes).toBe(2);
    expect((await post("compile-inspected", selected)).status).toBe(422);
    f.state.reject = true;
    expect((await post("inspect", f.input)).status).toBe(422); expect(f.state.closes).toBe(3);
  } finally { await host.close(); await f.dispose(); }
});

test("cancelling pending Electron inspection closes the source session and releases private staging", async () => {
  const f = await fixture(), controller = new AbortController();
  let release!: () => void;
  f.state.hold = new Promise<void>(resolveHold => { release = resolveHold; });
  const entered = new Promise<void>(resolveEntered => { f.state.entered = resolveEntered; });
  try {
    const inspection = inspectRemotionProject({ input: f.input, toolchainDirectory: f.toolchain,
      connectionFile: f.connectionFile, signal: controller.signal });
    const outcome = inspection.then(value => ({ value }), error => ({ error }));
    await entered; controller.abort();
    expect(await outcome).toMatchObject({ error: expect.any(Error) });
    expect(f.state).toMatchObject({ opens: 1, evaluations: 1, closes: 1 });
  } finally { release(); await f.dispose(); }
});

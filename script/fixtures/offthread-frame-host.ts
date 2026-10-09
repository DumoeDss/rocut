import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { createProgrammaticFrameService } from "../../apps/cli/src/programmatic/frame-service";
import { prepareRemotionProbe } from "./prepare-remotion-probe";
import { createHdrVideoFixture } from "./hdr-video-fixture";
import { readResourceFile, saveResourceBytes } from "../../apps/cli/src/programmatic/resource-bytes";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { HdrTransfer } from "./hdr-pixel-oracle";

// Intentionally tests the production compiler/frame service without the unrelated
// editing catalog. This is not full Host API or installed-plugin acceptance.
const toolchainDirectory = process.argv[2];
const ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (!toolchainDirectory || !ffmpeg || !ffprobe) throw Error("Expected toolchain and native test decoder paths");
const root = await mkdtemp(join(tmpdir(), "rocut-offthread-host-"));
const context = { store: new FileProjectStore({ root: join(root, "target"), schemaVersion: 1 }), projectId: "offthread" };
const service = createProgrammaticFrameService(process.env.ROCUT_HTML_BROWSER_PATH, undefined, context, { ffmpeg, ffprobe });
let server: ReturnType<typeof createServer> | undefined;
try {
	const spec = await prepareRemotionProbe(join(root, "author"));
	const { source } = await compileProgrammaticProject({
		action: "compile", input: { ...spec, inputProps: { mode: "offthread-video" } }, toolchainDirectory, context,
		signal: AbortSignal.timeout(30000), enqueue: task => task(),
	});
	const hdrSources: { source: ProgrammaticSource; transfer: HdrTransfer; alpha: number[] | null }[] = [];
	if (process.env.ROCUT_PROBE_HDR === "1") for (const transfer of ["smpte2084", "arib-std-b67"] as const) for (const alpha of [false, true]) {
		const video = await createHdrVideoFixture(root, ffmpeg, transfer, alpha);
		const resource = await readResourceFile(video.file, { id: `hdr/${transfer}-${alpha}.webm`, kind: "video", mimeType: "video/webm" }, AbortSignal.timeout(10000));
		await saveResourceBytes(context, resource, AbortSignal.timeout(10000));
		const compiled = await compileProgrammaticProject({ action: "compile", toolchainDirectory, context, signal: AbortSignal.timeout(30000), enqueue: task => task(),
			input: { ...spec, resources: [resource.resource], inputProps: { mode: "hdr-video", resourceId: resource.resource.id } } });
		const actualAlpha = alpha ? await video.run(["-c:v", "libvpx-vp9", "-i", video.file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], 8192) : undefined;
		hdrSources.push({ source: compiled.source, transfer, alpha: actualAlpha ? [8, 24, 40, 56].map(x => actualAlpha[(8 * 64 + x) * 4 + 3]) : null });
	}
	server = createServer((request, response) => {
		if (request.url === "/api/source") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(source)); return; }
		if (request.url === "/api/hdr-sources") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(hdrSources)); return; }
		if (request.url === "/api/programmatic/frame" && request.method === "POST") {
			void service.handle(request, response).catch(error => { console.error(error); response.destroy(); }); return;
		}
		response.writeHead(404).end();
	});
	await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw Error("No frame fixture address");
	console.log(JSON.stringify({ endpoint: `http://127.0.0.1:${address.port}`, capability: service.nativeVideoCapability }));
	await new Promise<void>(resolve => { process.stdin.once("data", () => resolve()); process.stdin.once("end", resolve); process.stdin.resume(); });
} finally {
	await service.dispose();
	if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
	process.stdin.pause();
	if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("rocut-offthread-host-")) throw Error("Unsafe fixture cleanup");
	await rm(root, { recursive: true, force: true });
}

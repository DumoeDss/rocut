import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createHdrVideoFixture } from "./hdr-video-fixture";

const ffmpeg = process.env.ROCUT_TEST_FFMPEG;
if (!ffmpeg) throw Error("Set ROCUT_TEST_FFMPEG");
const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "rocut-hdr-color-"));
try {
	const fixture = await createHdrVideoFixture(root, ffmpeg, "smpte2084");
	for (const filters of [
		"zscale=t=linear:npl=100,format=gbrpf32le",
		"zscale=t=linear:npl=100,format=gbrpf32le,zscale=primaries=709,tonemap=tonemap=hable:desat=0",
		"zscale=t=linear:npl=100,format=gbrpf32le,zscale=primaries=709,tonemap=tonemap=hable:desat=0,zscale=t=709",
	]) {
		const raw = await fixture.run(["-i", fixture.file, "-vf", filters, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gbrpf32le", "pipe:1"], 64 * 32 * 3 * 4);
		console.log(JSON.stringify({ filters, green: [5, 15, 25, 35, 45, 55].map(x => raw.readFloatLE((8 * 64 + x) * 4)) }));
	}
} finally {
	if (dirname(root) !== parent || !basename(root).startsWith("rocut-hdr-color-")) throw Error("Unsafe diagnostic cleanup");
	await rm(root, { recursive: true, force: true });
}

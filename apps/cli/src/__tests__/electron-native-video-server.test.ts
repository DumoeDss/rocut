import { expect, test } from "bun:test";
import { createElectronNativeVideoServer } from "../programmatic/electron-native-video-server";
import type { decodeNativeVideoFrame } from "../programmatic/video-decoder";

const src = "data:video/webm;base64,AQID";
const message = (id = 1, extra = {}) => ({
	version: 1,
	kind: "frame",
	id,
	src,
	seconds: 0.25,
	transparent: true,
	toneMapped: false,
	...extra,
});
async function fixture(decodeFrame?: typeof decodeNativeVideoFrame) {
	const calls: Parameters<typeof decodeNativeVideoFrame>[0][] = [];
	const signal = new AbortController();
	const server = await createElectronNativeVideoServer({
		code: `<video src="${src}">`,
		resources: [],
		limits: { maxBytes: 1024, maxDimension: 64, maxElements: 8 },
		decoder: { ffmpeg: "backend-owned", ffprobe: "backend-owned" },
		signal: signal.signal,
		decodeFrame: async (input) => {
			calls.push(input);
			return decodeFrame
				? decodeFrame(input)
				: {
						png: Buffer.from([137, 80, 78, 71]),
						index: 0,
						sourceTime: 0.25,
						width: 1,
						height: 1,
					};
		},
	});
	const post = (payload: unknown, token = server.callback.token) =>
		fetch(server.callback.endpoint, {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
			body: JSON.stringify({
				version: 1,
				contextId: 7,
				payload: JSON.stringify(payload),
			}),
		});
	return { ...server, calls, post, signal };
}

test("Electron native-video callback uses admitted bytes and original native nearest/HDR options", async () => {
	const f = await fixture();
	try {
		const response = await f.post(message());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: 1, png: "iVBORw==" });
		expect(f.calls[0]).toMatchObject({
			selection: "nearest",
			seconds: 0.25,
			transparent: true,
			toneMapped: false,
		});
		expect([...f.calls[0].body]).toEqual([1, 2, 3]);
		await f.check();
	} finally {
		await f.dispose();
	}
});

test("callback requires its token and resource admission even when page JS ignores a decode error", async () => {
	const f = await fixture();
	try {
		expect((await f.post(message(), "wrong-token")).status).toBe(403);
		const response = await f.post(message(1, { src: "file:///private.mp4" }));
		expect(await response.json()).toMatchObject({
			id: 1,
			error: expect.stringContaining("not admitted"),
		});
		await expect(f.check()).rejects.toThrow("not admitted");
		expect(f.calls).toHaveLength(0);
	} finally {
		await f.dispose();
	}
});

test("duplicate callback cannot steal the live reply, and native cancel drains its decoder", async () => {
	let started!: () => void;
	const entered = new Promise<void>((resolve) => {
		started = resolve;
	});
	const f = await fixture(async ({ signal }) => {
		started();
		return new Promise((_resolve, reject) =>
			signal.addEventListener("abort", () => reject(Error("cancelled")), {
				once: true,
			}),
		);
	});
	try {
		const pending = f.post(message());
		await entered;
		expect((await f.post(message())).status).toBe(422);
		expect(
			await (await f.post({ version: 1, kind: "cancel", id: 1 })).json(),
		).toEqual({ id: 1, cancelled: true });
		expect(await (await pending).json()).toEqual({
			id: 1,
			error: "Native video request aborted",
		});
		await f.check();
		expect(f.calls[0].signal.aborted).toBe(true);
	} finally {
		await f.dispose();
	}
});

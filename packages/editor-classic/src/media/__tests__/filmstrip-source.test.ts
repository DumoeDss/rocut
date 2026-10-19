import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { VideoElement } from "../../timeline/types";

if (process.env.EDITOR_FILMSTRIP_SOURCE_TEST !== "1") {
	test("filmstrip source-time wiring runs with the native time policy", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, EDITOR_FILMSTRIP_SOURCE_TEST: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	await import("../../editor/session/__tests__/wasm-test-mock");
	const { resolveFilmstripSourceTime } = await import("../filmstrip-source");
	const { mediaTime } = await import("../../wasm");
	const ticks = (value: number) => mediaTime({ ticks: value });
	const element: VideoElement = {
		id: "video",
		mediaId: "source",
		name: "Video",
		type: "video",
		params: {},
		startTime: ticks(600000),
		duration: ticks(480000),
		trimStart: ticks(240000),
		trimEnd: ticks(0),
		sourceDuration: ticks(1800000),
		retime: { rate: 2 },
	};
	test("scroll and zoom sample the same source frame at the same clip time", () => {
		expect(
			resolveFilmstripSourceTime({ element, offset: 100, pixelsPerSecond: 50 }),
		).toBe(720000);
		expect(
			resolveFilmstripSourceTime({
				element,
				offset: 200,
				pixelsPerSecond: 100,
			}),
		).toBe(720000);
		expect(
			resolveFilmstripSourceTime({ element, offset: 0, pixelsPerSecond: 50 }),
		).toBe(240000);
	});
	test("freeze uses its absolute source frame regardless of trim and offset", () => {
		const frozen = { ...element, freezeFrame: ticks(900000) };
		expect(
			resolveFilmstripSourceTime({
				element: frozen,
				offset: 0,
				pixelsPerSecond: 50,
			}),
		).toBe(900000);
		expect(
			resolveFilmstripSourceTime({
				element: frozen,
				offset: 150,
				pixelsPerSecond: 50,
			}),
		).toBe(900000);
	});
	test("invalid source span and empty clips do not decode the poster", () => {
		expect(
			resolveFilmstripSourceTime({
				element: { ...element, sourceDuration: ticks(300000) },
				offset: 100,
				pixelsPerSecond: 50,
			}),
		).toBeNull();
		expect(
			resolveFilmstripSourceTime({
				element: { ...element, duration: ticks(0) },
				offset: 0,
				pixelsPerSecond: 50,
			}),
		).toBeNull();
	});
}

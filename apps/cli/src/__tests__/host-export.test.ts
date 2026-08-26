/**
 * Export registry tests — the "borrow the pane's renderer" orchestration.
 *
 * The load-bearing behaviours, each a rule the design depends on rather than an
 * incidental detail: refusing when no pane is attached (there is no renderer,
 * so accepting would strand the job), broadcasting the command to every
 * attached pane, terminal-is-terminal under two panes obeying one broadcast,
 * writing ONLY inside the project directory, cancellation reaching the pane,
 * and the stale sweep settling a job whose pane went away mid-render.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	createExportRegistry,
	EXPORT_STALE_MS,
	NoSurfaceAttachedError,
	parseExportOptions,
	type SurfaceStream,
} from "../host-export";

function fakeSurface(): SurfaceStream & { frames: unknown[] } {
	const frames: unknown[] = [];
	return {
		frames,
		write(chunk: string) {
			for (const line of chunk.split("\n")) {
				if (line.startsWith("data: ")) frames.push(JSON.parse(line.slice(6)));
			}
		},
	};
}

async function withProjectDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(path.join(tmpdir(), "rocut-export-"));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const OPTIONS = { format: "mp4", quality: "high" } as const;

describe("export registry", () => {
	test("refuses to start when no pane is attached", async () => {
		await withProjectDir(async (projectDir) => {
			const registry = createExportRegistry({ projectDir });
			expect(registry.surfaceCount()).toBe(0);
			expect(() => registry.start(OPTIONS)).toThrow(NoSurfaceAttachedError);
		});
	});

	test("broadcasts the start command to every attached pane", async () => {
		await withProjectDir(async (projectDir) => {
			const registry = createExportRegistry({ projectDir });
			const a = fakeSurface();
			const b = fakeSurface();
			registry.attachSurface(a);
			registry.attachSurface(b);
			expect(registry.surfaceCount()).toBe(2);

			const job = registry.start(OPTIONS);
			for (const surface of [a, b]) {
				expect(surface.frames).toEqual([
					{ command: "export.start", jobId: job.id, options: OPTIONS },
				]);
			}
		});
	});

	test("detaching a pane stops it receiving frames and drops the count", async () => {
		await withProjectDir(async (projectDir) => {
			const registry = createExportRegistry({ projectDir });
			const surface = fakeSurface();
			const detach = registry.attachSurface(surface);
			detach();
			expect(registry.surfaceCount()).toBe(0);
			expect(() => registry.start(OPTIONS)).toThrow(NoSurfaceAttachedError);
			expect(surface.frames).toEqual([]);
		});
	});

	test("command frames are tagged so a revision consumer can tell them apart", async () => {
		await withProjectDir(async (projectDir) => {
			const registry = createExportRegistry({ projectDir });
			const surface = fakeSurface();
			registry.attachSurface(surface);
			const job = registry.start(OPTIONS);
			registry.cancel(job.id);
			// The host writes `{revision}` frames onto this same stream from a
			// separate per-connection writer, so every frame this registry emits
			// MUST carry `command` and MUST NOT carry `revision`.
			for (const frame of surface.frames) {
				expect(frame).toHaveProperty("command");
				expect(frame).not.toHaveProperty("revision");
			}
		});
	});

	test("completion writes inside the project dir and reports the path", async () => {
		await withProjectDir(async (projectDir) => {
			const registry = createExportRegistry({ projectDir });
			registry.attachSurface(fakeSurface());
			const job = registry.start(OPTIONS);

			registry.reportProgress(job.id, 0.5);
			expect(registry.get(job.id)?.status).toBe("running");
			expect(registry.get(job.id)?.progress).toBe(0.5);

			const bytes = new Uint8Array([1, 2, 3, 4]);
			const done = await registry.complete(job.id, bytes);
			expect(done?.status).toBe("completed");
			expect(done?.progress).toBe(1);

			const out = done?.outputPath ?? "";
			expect(path.relative(projectDir, out).startsWith("..")).toBe(false);
			expect(out.endsWith(".mp4")).toBe(true);
			expect(new Uint8Array(await readFile(out))).toEqual(bytes);
		});
	});

	test("terminal is terminal — a second pane cannot reopen a settled job", async () => {
		await withProjectDir(async (projectDir) => {
			const registry = createExportRegistry({ projectDir });
			registry.attachSurface(fakeSurface());
			const job = registry.start(OPTIONS);

			await registry.complete(job.id, new Uint8Array([9]));
			const first = registry.get(job.id)?.outputPath;

			// The second pane obeyed the same broadcast and reports too.
			await registry.complete(job.id, new Uint8Array([1, 1, 1, 1, 1]));
			registry.fail(job.id, "second pane failed");
			registry.reportProgress(job.id, 0.2);

			const after = registry.get(job.id);
			expect(after?.status).toBe("completed");
			expect(after?.outputPath).toBe(first);
			expect(after?.error).toBeUndefined();
			expect(new Uint8Array(await readFile(first ?? ""))).toEqual(
				new Uint8Array([9]),
			);
		});
	});

	test("cancel sets the flag and reaches the pane", async () => {
		await withProjectDir(async (projectDir) => {
			const registry = createExportRegistry({ projectDir });
			const surface = fakeSurface();
			registry.attachSurface(surface);
			const job = registry.start(OPTIONS);

			registry.cancel(job.id);
			expect(registry.get(job.id)?.cancelRequested).toBe(true);
			expect(surface.frames.at(-1)).toEqual({
				command: "export.cancel",
				jobId: job.id,
			});
		});
	});

	test("a job whose pane stops reporting is swept to failed", async () => {
		await withProjectDir(async (projectDir) => {
			let clock = 1_000;
			const registry = createExportRegistry({
				projectDir,
				now: () => clock,
			});
			registry.attachSurface(fakeSurface());
			const job = registry.start(OPTIONS);

			clock += EXPORT_STALE_MS + 1;
			const swept = registry.get(job.id);
			expect(swept?.status).toBe("failed");
			expect(swept?.error).toContain("stopped reporting");
		});
	});
});

describe("parseExportOptions", () => {
	test("defaults to mp4 / high", () => {
		expect(parseExportOptions({})).toEqual({ format: "mp4", quality: "high" });
	});

	test("passes includeAudio through when present", () => {
		expect(
			parseExportOptions({ format: "webm", quality: "low", includeAudio: false }),
		).toEqual({ format: "webm", quality: "low", includeAudio: false });
	});

	/**
	 * No fps override, on purpose. The editor's `FrameRate` is a RATIONAL
	 * (`{numerator, denominator}`) because the real broadcast rates are
	 * 30000/1001 and 24000/1001 — a decimal `29.97` on the wire silently becomes
	 * 2997/100 and drifts. `exportProject` already falls back to the project's
	 * own settings (`fps ?? activeProject.settings.fps`), which is the right
	 * answer nearly always, so v1 declines the override rather than shipping a
	 * lossy one. Re-adding it means carrying the rational, not a number.
	 */
	test("ignores an fps override rather than accepting a lossy decimal", () => {
		expect(parseExportOptions({ fps: 29.97 })).toEqual({
			format: "mp4",
			quality: "high",
		});
	});

	test("rejects unknown values rather than silently defaulting", () => {
		expect(typeof parseExportOptions({ format: "mkv" })).toBe("string");
		expect(typeof parseExportOptions({ quality: "ultra" })).toBe("string");
		expect(typeof parseExportOptions({ includeAudio: "yes" })).toBe("string");
		expect(typeof parseExportOptions(null)).toBe("string");
	});
});

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

test("lens parameters and explicit trajectory survive transactions and Host restart", async () => {
	const parent = resolve(tmpdir());
	const root = await mkdtemp(join(parent, "rocut-spatial-reopen-"));
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	const post = (body: unknown) =>
		fetch(new URL("api/apply", host.editorUrl), {
			method: "POST",
			body: JSON.stringify(body),
		});
	const editing = {
		type: "graphic",
		name: "Spatial scene",
		definitionId: "programmatic",
		params: {},
		programmatic: {
			version: 1,
			runtime: "canvas-worker",
			code: "const ctx = canvas.getContext('2d'); ctx.fillRect(0, 0, 64, 32);",
			width: 64,
			height: 32,
			frameRate: { numerator: 30, denominator: 1 },
			durationFrames: 30,
			seed: 1,
		},
		effects: [
			{
				id: "lens-a",
				type: "lens",
				enabled: true,
				params: {
					centerX: 0.5,
					centerY: 0.5,
					radius: 0.25,
					feather: 0.2,
					zoom: 2,
					refraction: 0.3,
					dispersion: 0.05,
					amount: 1,
				},
			},
		],
		animations: {
			"effects.lens-a.params.centerX": {
				keys: [0, 120000].map((ticks, i) => ({
					id: `x${i}`,
					time: ticks,
					value: i === 0 ? 0.1 : 0.9,
					segmentToNext: "linear",
					tangentMode: "auto",
				})),
			},
		},
	};
	try {
		const response = await post({
			expectedRevision: 0,
			operations: [
				{
					kind: "create-track",
					track: {
						id: "visual",
						name: "Visual",
						kind: "graphic",
						hidden: false,
					},
				},
				{
					kind: "create-clip",
					clip: {
						id: "scene",
						trackId: "visual",
						startTime: 12000,
						duration: 120000,
						trimStart: 0,
						trimEnd: 0,
						editing,
					},
				},
			],
		});
		const result = await response.json();
		expect(response.status, JSON.stringify(result)).toBe(200);
		const before = await host.automation.clips();
		expect(before[0].editing).toMatchObject(editing);
		await host.close();
		host = await startHost(options);
		expect(await host.automation.clips()).toEqual(before);
		const rejected = await post({
			expectedRevision: 1,
			operations: [
				{
					kind: "update-clip",
					clipId: "scene",
					patch: {
						editing: {
							...editing,
							effects: [
								{
									...editing.effects[0],
									params: { ...editing.effects[0].params, radius: -1 },
								},
							],
						},
					},
				},
			],
		});
		expect(rejected.status).toBe(409);
		expect(await host.automation.clips()).toEqual(before);
	} finally {
		await host.close();
		if (
			dirname(root) !== parent ||
			!basename(root).startsWith("rocut-spatial-reopen-")
		)
			throw Error("Unsafe spatial fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
});

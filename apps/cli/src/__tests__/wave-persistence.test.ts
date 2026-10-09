import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

test("wave schedules survive real Host restart and invalid batches roll back", async () => {
	const parent = resolve(tmpdir());
	const root = await mkdtemp(join(parent, "rocut-wave-reopen-"));
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	const post = (operations: unknown[], expectedRevision: number) =>
		fetch(new URL("api/apply", host.editorUrl), {
			method: "POST",
			body: JSON.stringify({ operations, expectedRevision }),
		});
	try {
		const catalog = await (
			await fetch(new URL("api/editing/catalog", host.editorUrl))
		).json();
		const effects = ["ripple", "force-field"].map((type) => ({
			id: type,
			type,
			enabled: true,
			params: {
				...Object.fromEntries(
					catalog.effects[type]
						.filter((p: { required?: boolean }) => p.required !== false)
						.map((p: { key: string; default: number }) => [p.key, p.default]),
				),
				eventCount: 2,
				event0Time: 4004,
				event0X: 0.2,
				event0Y: 0.3,
				event0Amplitude: 0.7,
				event1Time: 120000,
				event1X: 0.8,
				event1Y: 0.6,
				event1Amplitude: -0.4,
			} as Record<string, number>,
		}));
		const editing = { type: "text", name: "Wave source", params: {}, effects };
		const layer = {
			type: "effect",
			name: "Wave layer",
			effectType: "ripple",
			params: effects[0].params,
		};
		const created = await post(
			[
				{
					kind: "create-track",
					track: {
						id: "text-track",
						name: "Source",
						kind: "text",
						hidden: false,
					},
				},
				{
					kind: "create-track",
					track: {
						id: "fx-track",
						name: "Wave layer",
						kind: "effect",
						hidden: false,
					},
				},
				{
					kind: "create-clip",
					clip: {
						id: "source",
						trackId: "text-track",
						startTime: 0,
						duration: 240000,
						trimStart: 0,
						trimEnd: 0,
						editing,
					},
				},
				{
					kind: "create-clip",
					clip: {
						id: "wave-layer",
						trackId: "fx-track",
						startTime: 0,
						duration: 240000,
						trimStart: 0,
						trimEnd: 0,
						editing: layer,
					},
				},
			],
			0,
		);
		expect(created.status, JSON.stringify(await created.json())).toBe(200);
		const before = await host.automation.clips();
		expect(before.find((c) => c.id === "source")?.editing).toMatchObject(
			editing,
		);
		await host.close();
		host = await startHost(options);
		expect(await host.automation.clips()).toEqual(before);
		const invalidParams = [
			{ ...effects[0].params, eventCount: 17 },
			{ ...effects[0].params, eventCount: 1.5 },
			{ ...effects[0].params, event0Time: 0.5 },
			{ ...effects[0].params, event0Time: -1 },
			{ ...effects[0].params, event0X: 3 },
			{ ...effects[0].params, event16Time: 0 },
			Object.fromEntries(
				Object.entries(effects[0].params).filter(
					([key]) => key !== "event1Amplitude",
				),
			),
		];
		for (const params of invalidParams) {
			for (const effectLayer of [false, true]) {
				const invalid = effectLayer
					? { ...layer, params }
					: { ...editing, effects: [{ ...effects[0], params }] };
				const rejected = await post(
					[
						{
							kind: "create-track",
							track: {
								id: "must-roll-back",
								name: "Atomic sentinel",
								kind: "text",
								hidden: false,
							},
						},
						{
							kind: "update-clip",
							clipId: effectLayer ? "wave-layer" : "source",
							patch: { editing: invalid },
						},
					],
					1,
				);
				expect(rejected.status, JSON.stringify(await rejected.json())).toBe(
					409,
				);
				expect(await host.automation.clips()).toEqual(before);
			}
		}
		const accepted = await post(
			[
				{
					kind: "update-clip",
					clipId: "wave-layer",
					patch: {
						editing: { ...layer, params: { ...layer.params, eventCount: 1 } },
					},
				},
			],
			1,
		);
		expect(accepted.status, JSON.stringify(await accepted.json())).toBe(200);
		expect(
			(await host.automation.tracks()).some((t) => t.id === "must-roll-back"),
		).toBe(false);
	} finally {
		await host.close();
		if (
			dirname(root) !== parent ||
			!basename(root).startsWith("rocut-wave-reopen-")
		)
			throw Error("Unsafe wave fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
});

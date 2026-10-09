import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import * as wasm from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { lightLeakSource } from "../../../../script/fixtures/mv-light-leak-source";
import { lightLeakAudioFixture } from "../../../../script/fixtures/mv-light-leak-audio";

test("light-leak capability, role/composite declaration and amount curve persist through Agent edits and Host restart", async () => {
	const parent = resolve(tmpdir()),
		root = await mkdtemp(join(parent, "rocut-light-leak-store-"));
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	const post = (route: string, body: unknown) =>
		fetch(new URL(`api/${route}`, host.editorUrl), {
			method: "POST",
			body: JSON.stringify(body),
		});
	const json = async (route: string, body: unknown) => {
		const r = await post(route, body),
			value = await r.json();
		if (!r.ok) throw Error(JSON.stringify(value));
		return value;
	};
	const editing = (source: ProgrammaticSource) => ({
		type: "graphic",
		definitionId: "programmatic",
		params: {},
		programmatic: source,
	});
	const current = async () =>
		(await host.automation.clips())[0]!.editing!.programmatic;
	try {
		const catalog = await (
			await fetch(new URL("api/editing/catalog", host.editorUrl))
		).json();
		expect(
			catalog.programmatic.mvRecipe.extensions.finishing.effects.lightLeak
				.parameters.alpha.required,
		).toBe(true);
		const source = lightLeakSource();
		const context = await (
			await fetch(new URL("api/context", host.editorUrl))
		).json();
		await json("apply", {
			expectedRevision: 0,
			operations: [
				{
					kind: "update-project",
					projectId: context.project.id,
					// Project and source both use 4004 ticks/frame. A default
					// 30 fps Host cannot accept this rational-rate clip boundary.
					patch: { frameRate: source.frameRate },
				},
				{
					kind: "create-track",
					track: { id: "leaks", name: "Leaks", kind: "graphic", hidden: false },
				},
				{
					kind: "create-clip",
					clip: {
						id: "leak",
						trackId: "leaks",
						startTime: 0,
						duration: 1201200,
						trimStart: 0,
						trimEnd: 0,
						editing: editing(source),
					},
				},
			],
		});
		await host.close();
		host = await startHost(options);
		expect(await current()).toEqual(source);
		expect((await host.automation.project())?.frameRate).toEqual(
			source.frameRate,
		);
		const changed: ProgrammaticSource = {
			...source,
			recipe: {
				...source.recipe!,
				post: [
					{
						stage: "role",
						roles: ["foreground"],
						effects: [
							{
								kind: "lightLeak",
								amount: 0.4,
								alpha: "preserve",
								speed: 0.75,
								seedOffset: 7,
							},
						],
						automation: [
							{
								effect: 0,
								keyframes: [
									{ frame: 0, value: 0, easing: "linear" },
									{ frame: 100, value: 1, easing: "inQuad" },
								],
							},
						],
					},
				],
			},
		};
		await json("apply", {
			expectedRevision: 1,
			operations: [
				{
					kind: "update-clip",
					clipId: "leak",
					patch: { editing: editing(changed) },
				},
			],
		});
		await host.close();
		host = await startHost(options);
		expect(await current()).toEqual(changed);
		expect((await host.automation.project())?.frameRate).toEqual(
			source.frameRate,
		);
		const bad = structuredClone(changed) as any;
		bad.recipe.post[0].effects[0].speed = 100;
		expect(
			(
				await post("apply", {
					expectedRevision: 2,
					operations: [
						{
							kind: "update-clip",
							clipId: "leak",
							patch: { editing: editing(bad) },
						},
					],
				})
			).status,
		).toBe(409);
		expect(await current()).toEqual(changed);
		await json("apply", {
			expectedRevision: 2,
			operations: [
				{
					kind: "update-clip",
					clipId: "leak",
					patch: { editing: editing(source) },
				},
			],
		});
		await host.close();
		host = await startHost(options);
		expect(await current()).toEqual(source);
		expect((await host.automation.project())?.frameRate).toEqual(
			source.frameRate,
		);
	} finally {
		await host.close();
		if (
			dirname(root) !== parent ||
			!basename(root).startsWith("rocut-light-leak-store-")
		)
			throw Error("Unsafe light-leak fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

test("light leak applies curve replacement then reviewed audio delta/clamp before resolving gradient alpha", async () => {
	const { source, data, expectedAmount } = await lightLeakAudioFixture();
	const map = (s: ProgrammaticSource) =>
		JSON.parse(
			wasm.resolveProgrammaticFrameJson(
				JSON.stringify({
					source: s,
					clipStart: 0,
					clipDuration: 1201200,
					trimStart: 0,
					timelineTime: 0,
					analysis: data,
				}),
			),
		);
	const effect = map(source).frame.recipePlan.post[0].effects[0];
	expect(effect.effect.amount).toBeCloseTo(expectedAmount, 12);
	for (const [amount, expected] of [
		[-1, 0],
		[2, 1],
	] as const) {
		const changed = structuredClone(source) as any;
		changed.recipe.post[0].audio[0].amount = amount === 2 ? 1 : amount;
		if (amount === 2)
			changed.recipe.post[0].automation[0].keyframes[0].value = 0.8;
		const plan = map(changed).frame.recipePlan.post[0].effects[0];
		expect(plan.effect.amount).toBe(expected);
		expect(plan.lightLeak.gradients[0].stops[0].color[3]).toBeCloseTo(
			(effect.lightLeak.gradients[0].stops[0].color[3] * expected) /
				expectedAmount,
			12,
		);
	}
});

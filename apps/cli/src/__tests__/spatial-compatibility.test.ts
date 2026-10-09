import { expect, test } from "bun:test";
import { revisionOf } from "@opencut/editor-contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

test("old ASCII/dither effects and layers remain editable across Host restart", async () => {
	const parent = resolve(tmpdir());
	const root = await mkdtemp(join(parent, "rocut-spatial-compat-"));
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	const post = (operations: unknown[], expectedRevision = 1) =>
		fetch(new URL("api/apply", host.editorUrl), {
			method: "POST",
			body: JSON.stringify({ expectedRevision, operations }),
		});
	const variants = ["ascii", "retro-dither"].flatMap((type) =>
		[false, true].map((layer) => {
			const params: Record<string, number> =
				type === "ascii"
					? { amount: 1, cellSize: 12, contrast: 1, color: 1, seed: 1 }
					: { amount: 1, cellSize: 2, levels: 4, spread: 1, seed: 1 };
			const editing = (values: Record<string, number>) =>
				layer
					? { type: "effect", name: type, effectType: type, params: values }
					: {
							type: "text",
							name: type,
							params: { content: "Legacy style" },
							effects: [{ id: "style", type, enabled: true, params: values }],
						};
			return {
				id: `${type}-${layer ? "layer" : "clip"}`,
				kind: layer ? "effect" : "text",
				params,
				editing,
			};
		}),
	);
	try {
		const response = await post(
			variants.flatMap((v) => [
				{
					kind: "create-track",
					track: {
						id: `track-${v.id}`,
						name: v.id,
						kind: v.kind,
						hidden: false,
					},
				},
				{
					kind: "create-clip",
					clip: {
						id: v.id,
						trackId: `track-${v.id}`,
						startTime: 0,
						duration: 120000,
						trimStart: 0,
						trimEnd: 0,
						editing: v.editing(v.params),
					},
				},
			]),
			0,
		);
		expect(response.status, JSON.stringify(await response.json())).toBe(200);
		const before = await host.automation.clips();
		for (const v of variants)
			expect(before.find((c) => c.id === v.id)?.editing).toMatchObject(
				v.editing(v.params),
			);
		await host.close();
		host = await startHost(options);
		expect(await host.automation.clips()).toEqual(before);
		for (const v of variants) {
			const { amount: _amount, ...missingAmount } = v.params;
			for (const params of [
				missingAmount,
				{ ...v.params, radius: -1 },
				{ ...v.params, local: 2 },
			]) {
				const rejected = await post([
					{
						kind: "update-clip",
						clipId: v.id,
						patch: { editing: v.editing(params) },
					},
				]);
				expect(rejected.status).toBe(409);
				expect(await host.automation.clips()).toEqual(before);
				expect(await host.automation.revision()).toBe(revisionOf(1));
			}
		}
		const updated = await post(
			variants.map((v) => ({
				kind: "update-clip",
				clipId: v.id,
				patch: { editing: v.editing({ ...v.params, local: 1, centerX: 0.3 }) },
			})),
		);
		expect(updated.status, JSON.stringify(await updated.json())).toBe(200);
		await host.close();
		host = await startHost(options);
		const after = await host.automation.clips();
		for (const v of variants)
			expect(after.find((c) => c.id === v.id)?.editing).toMatchObject(
				v.editing({ ...v.params, local: 1, centerX: 0.3 }),
			);
	} finally {
		await host.close();
		if (
			dirname(root) !== parent ||
			!basename(root).startsWith("rocut-spatial-compat-")
		)
			throw Error("Unsafe spatial compatibility fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
});

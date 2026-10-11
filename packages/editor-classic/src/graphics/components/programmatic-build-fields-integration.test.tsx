import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import { ProgrammaticBuildFields } from "./programmatic-build-fields";
import { OBJECT_PARAMETER_FIELDS } from "./programmatic-object-parameter-data";

const descriptor = (id: string) => ({
	id,
	byteLength: 12,
	sha256: "e".repeat(64),
	attachmentKey: `programmatic-sha256-${"e".repeat(64)}`,
});

const sourceDescriptor = (id: string) => ({
	...descriptor(id),
	kind: "source",
	mimeType: "application/octet-stream",
	attachmentKey: `programmatic-source-sha256-${"e".repeat(64)}`,
});

function state(
	entry: string,
	inputProps: Record<string, unknown>,
	capabilities: string[] = [],
	inputs = [entry],
): BuildDraftSnapshot {
	return {
		baseline: {
			build: {
				engine: "three",
				entryFile: entry,
				inputs: inputs.map(sourceDescriptor),
				capabilities,
				inputProps,
			},
			resources: [
				{
					...descriptor(inputProps.modelId as string),
					kind: "model",
					mimeType: "model/gltf-binary",
				},
			],
		} as unknown as BuildDraftSnapshot["baseline"],
		selectedId: entry,
		entryFile: entry,
		fileIds: [],
		files: {},
		inputProps: JSON.stringify(inputProps),
		dirty: true,
		conflict: false,
		phase: null,
		error: null,
	};
}

// SSR checks real parent/child composition, not browser events or draft history.
function html(
	snapshot: BuildDraftSnapshot,
	canCompile = true,
	onInspectAnimation?: ProgrammaticFrameProvider["inspectAnimation"],
) {
	const unexpected = () => {
		throw Error("render must not invoke actions");
	};
	return renderToStaticMarkup(
		<ProgrammaticBuildFields
			id="p"
			state={snapshot}
			canLoad={true}
			canCompile={canCompile}
			onSelect={unexpected}
			onEdit={unexpected}
			onRetry={unexpected}
			onApply={unexpected}
			onDiscard={unexpected}
			onCancel={unexpected}
			onFiles={unexpected}
			onInspectAnimation={onInspectAnimation}
		/>,
	);
}

function applyButton(markup: string) {
	const buttons =
		markup.match(/<button\b[^>]*>Recompile and apply<\/button>/g) ?? [];
	expect(buttons).toHaveLength(1);
	return buttons[0];
}

function instanceState() {
	return state(
		"particle-instanced-scene.ts",
		{
			modelId: "assets/static.glb",
			instances: [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
			instanceColors: [[0.2, 0.3, 0.4]],
			unknown: { keep: [false, "future"] },
			motion: {
				version: 1,
				control: {
					mode: "spring",
					startTicks: 1000,
					durationTicks: 2000,
					restoringForce: 1,
					damping: 0,
					radius: 2,
					strength: 1,
					knots: [{ timeTicks: 1000, position: [0, 0, 0] }],
				},
			},
		},
		["particle-surface-v1"],
		[
			"particle-instanced-scene.ts",
			"particle-instanced-geometry.mjs",
			"particle-scene.ts",
		],
	);
}

test("parent renders ordinary GLB animation index and named clip branches", () => {
	for (const clip of [0, "Exact clip"]) {
		const markup = html(
			state("model-feature-scene.ts", {
				assetKind: "model",
				modelId: "assets/model.glb",
				animation: { clip, mode: "loop" },
			}),
		);
		expect(markup).toContain("GLB animation fields");
		const input = markup.match(/<input\b[^>]*id="p-animation-clip"[^>]*>/)?.[0];
		expect(input).toBeDefined();
		if (typeof clip === "number") {
			expect(input).toContain('type="number"');
			expect(markup).toContain("animation.clip (zero-based index)");
		} else {
			expect(input).toContain('value="Exact clip"');
			expect(input).not.toContain('type="number"');
		}
		expect(applyButton(markup)).not.toContain('disabled=""');
	}
});

test("parent exposes explicit animation inspection without calling the service on render", () => {
	const snapshot = state("model-feature-scene.ts", {
		assetKind: "model",
		modelId: "assets/model.glb",
		animation: { clip: 0, mode: "loop" },
	});
	const before = structuredClone(snapshot);
	const inspect: NonNullable<
		ProgrammaticFrameProvider["inspectAnimation"]
	> = async () => {
		throw Error("inspection must require a user action");
	};
	for (const provider of [undefined, inspect]) {
		const markup = html(snapshot, true, provider);
		const button = markup.match(
			/<button\b[^>]*>Read archived GLB clips<\/button>/,
		)?.[0];
		expect(button).toBeDefined();
		expect(button?.includes('disabled=""')).toBe(!provider);
		expect(markup).toContain('id="p-animation-clip"');
		expect(snapshot).toEqual(before);
		applyButton(markup);
	}
});

test("parent exposes Glass, Ink and Liquid public parameter panels", () => {
	for (const kind of ["glass", "ink", "liquid"] as const) {
		const field = OBJECT_PARAMETER_FIELDS[kind][0];
		const entry = `${kind}-object-scene.ts`;
		const markup = html(
			state(
				entry,
				{
					modelId: "assets/object.glb",
					[kind]: {
						version: 1,
						seed: 19,
						[field.key]:
							field.type === "number"
								? 0.5
								: field.type === "boolean"
									? true
									: "#ABCdef",
					},
				},
				kind === "liquid" ? ["liquid-object-v1"] : [],
				kind === "liquid" ? [entry, "liquid-object-geometry.mjs"] : [entry],
			),
		);
		expect(markup).toContain(
			`${kind[0].toUpperCase()}${kind.slice(1)} object fields`,
		);
		expect(markup).toContain(`id="p-object-${kind}-${field.key}"`);
		expect(markup).toContain('id="p-props"');
		applyButton(markup);
	}
});

test("declared scene fields share the parent draft and do not duplicate Particle transforms", () => {
	const snapshot = state("model-feature-scene.ts", {
		assetKind: "model",
		modelId: "assets/model.glb",
		camera: { position: [1, 2, 3], target: [0, 0, 0], fov: 45 },
		scale: 2,
		rotation: [0, 1, 0],
		backgroundColor: "#ABCdef",
		unknown: { keep: true },
	});
	const before = structuredClone(snapshot);
	const markup = html(snapshot);
	for (const key of [
		"camera-position",
		"camera-target",
		"camera-fov",
		"scale",
		"rotation",
		"backgroundColor",
	])
		expect(markup).toContain(`id="p-scene-${key}"`);
	expect(markup).not.toContain('id="p-scene-camera-near"');
	expect(markup).not.toContain('id="p-scene-intensity"');
	expect(markup).toContain('id="p-props"');
	expect(snapshot).toEqual(before);
	applyButton(markup);
	const originalParticle = instanceState();
	const particleProps = {
		...(originalParticle.baseline.build!.inputProps as Record<string, unknown>),
		camera: { position: [0, 0, 4] },
		scale: 1,
		rotation: [0, 0, 0],
		rotationSpeed: [0, 0.1, 0],
	};
	const particle = {
		...originalParticle,
		baseline: {
			...originalParticle.baseline,
			build: { ...originalParticle.baseline.build!, inputProps: particleProps },
		},
		inputProps: JSON.stringify(particleProps),
	};
	const combined = html(particle);
	expect(combined).toContain('id="p-scene-camera-position"');
	expect(combined).toContain('id="p-scene-rotation"');
	expect(combined).not.toContain('id="p-scene-scale"');
	expect(combined).not.toContain('id="p-scene-rotationSpeed"');
	applyButton(combined);
});

test("instances, colors and control coexist with the original JSON draft and sole apply action", () => {
	const snapshot = instanceState();
	const markup = html(snapshot);
	for (const id of [
		"instances",
		"instanceColors",
		"particle-motion-control-mode",
		"particle-motion-control-knots",
		"props",
	])
		expect(markup).toContain(`id="p-${id}"`);
	const textarea = markup.match(
		/<textarea\b[^>]*id="p-props"[^>]*>([\s\S]*?)<\/textarea>/,
	)?.[1];
	expect(textarea).toBe(
		snapshot.inputProps
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#x27;"),
	);
	expect(applyButton(markup)).not.toContain('disabled=""');
	expect(
		markup
			.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
			?.map((button) => button.replace(/<[^>]+>/g, "")),
	).toEqual([
		"Add file",
		"Rename file",
		"Delete file",
		"Load file",
		"Discard",
		"Recompile and apply",
	]);
});

test("unrelated engines hide specialized panels; blocked states disable the sole apply action", () => {
	const snapshot = instanceState();
	for (const engine of ["remotion", "hyperframes"] as const) {
		const markup = html({
			...snapshot,
			baseline: {
				...snapshot.baseline,
				build: { ...snapshot.baseline.build!, engine },
			},
		});
		expect(markup).not.toContain("<fieldset");
		expect(markup.includes('id="p-props"')).toBe(engine !== "hyperframes");
		applyButton(markup);
	}
	for (const patch of [
		{ phase: "loading" },
		{ phase: "compiling" },
		{ phase: "saving" },
		{ conflict: true },
		{ dirty: false },
	] as Partial<BuildDraftSnapshot>[]) {
		expect(applyButton(html({ ...snapshot, ...patch }))).toContain(
			'disabled=""',
		);
	}
	const unavailable = html(snapshot, false);
	expect(applyButton(unavailable)).toContain('disabled=""');
	for (const markup of [
		unavailable,
		html({ ...snapshot, phase: "compiling" }),
		html({ ...snapshot, conflict: true }),
	]) {
		expect(markup).toMatch(/<fieldset\b[^>]*disabled=""/);
		expect(markup).toMatch(/<textarea\b[^>]*id="p-instances"[^>]*disabled=""/);
	}
});

import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { ProgrammaticBuildFields } from "./programmatic-build-fields";
import { ProgrammaticParticleFields } from "./programmatic-particle-fields";
import { editParticleDraft } from "./programmatic-particle-data";

interface Control {
	id?: string;
	children?: ReactNode;
	disabled?: boolean;
	value?: unknown;
	defaultValue?: unknown;
	onChange?: (event: {
		target: {
			value: string;
			valueAsNumber?: number;
			setCustomValidity?: (message: string) => void;
		};
	}) => void;
}
function find({
	node,
	id,
}: {
	node: ReactNode;
	id: string;
}): Control | undefined {
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = find({ node: child, id });
			if (found) return found;
		}
	} else if (isValidElement<Control>(node)) {
		if (node.props.id === id) return node.props;
		return find({ node: node.props.children, id });
	}
}
const props = () => ({
	count: 1024,
	scale: 1,
	rotationSpeed: [0, 0.3, 0],
	unknown: { preserve: [1, false] },
	motion: {
		version: 1,
		size: 2,
		unknown: "keep",
		control: {
			mode: "spring",
			startTicks: 1000,
			durationTicks: 2000,
			restoringForce: 1,
			damping: 0,
			radius: 2,
			strength: 1,
			axis: [0, 0, 1],
			extra: "keep",
			knots: [
				{ timeTicks: 1000, position: [0, 0, 0], extra: "keep" },
				{ timeTicks: 3000, position: [1, 2, 3] },
			],
		},
	},
});
function state({
	text = JSON.stringify(props()),
	changes = {},
}: {
	text?: string;
	changes?: Partial<BuildDraftSnapshot>;
} = {}): BuildDraftSnapshot {
	return {
		baseline: {
			build: {
				engine: "three",
				capabilities: ["particle-surface-v1"],
				inputs: [],
				entryFile: "scene.ts",
				inputProps: props(),
			},
		} as unknown as BuildDraftSnapshot["baseline"],
		selectedId: "scene.ts",
		entryFile: "scene.ts",
		fileIds: [],
		files: {},
		inputProps: text,
		dirty: false,
		conflict: false,
		phase: null,
		error: null,
		...changes,
	};
}

test("particle fields edit exact existing JSON paths and preserve unknown author props without range clamps", () => {
	let text = JSON.stringify(props());
	const fields = () =>
		ProgrammaticParticleFields({
			id: "p",
			state: state({ text }),
			canCompile: true,
			onEdit: (patch) => {
				text = patch.inputProps;
			},
		});
	for (const [id, value] of [
		["count", 1.25],
		["scale", -3],
		["rotationSpeed-1", 0.123456789],
		["motion-size", -2],
		["motion-control-radius", -4],
		["motion-control-axis-2", 0.987654321],
	] as const)
		find({ node: fields(), id: `p-particle-${id}` })?.onChange?.({
			target: { value: String(value), valueAsNumber: value },
		});
	find({ node: fields(), id: "p-particle-motion-control-mode" })?.onChange?.({
		target: { value: "vortex" },
	});
	const value = JSON.parse(text);
	expect(value).toMatchObject({
		count: 1.25,
		scale: -3,
		rotationSpeed: [0, 0.123456789, 0],
		unknown: props().unknown,
		motion: {
			unknown: "keep",
			size: -2,
			control: {
				mode: "vortex",
				radius: -4,
				axis: [0, 0, 0.987654321],
				extra: "keep",
				knots: props().motion.control.knots,
			},
		},
	});
	const before = text;
	find({ node: fields(), id: "p-particle-count" })?.onChange?.({
		target: { value: "", valueAsNumber: NaN },
	});
	expect(text).toBe(before);
	expect(
		editParticleDraft({ text, path: ["missing"], next: 1 }),
	).toBeUndefined();
	expect(
		editParticleDraft({ text, path: ["count"], next: Infinity }),
	).toBeUndefined();
});

test("knots JSON retains incomplete text without changing draft and transports complete authored entries unchanged", () => {
	let text = JSON.stringify(props()),
		validity = "";
	const fields = () =>
		ProgrammaticParticleFields({
			id: "p",
			state: state({ text }),
			canCompile: true,
			onEdit: (patch) => {
				text = patch.inputProps;
			},
		});
	const before = text;
	const target = {
		value: "[",
		setCustomValidity: (message: string) => {
			validity = message;
		},
	};
	find({ node: fields(), id: "p-particle-motion-control-knots" })?.onChange?.({
		target,
	});
	expect(target.value).toBe("[");
	expect(text).toBe(before);
	expect(validity).toContain("Fix control knots JSON");
	target.value = '[{"position":[1e400,0,0]}]';
	find({ node: fields(), id: "p-particle-motion-control-knots" })?.onChange?.({
		target,
	});
	expect(text).toBe(before);
	expect(validity).toContain("Fix control knots JSON");
	// No renderer ordering/range admission: Rust decides whether this schedule is valid.
	const knots = [
		{ timeTicks: 9999, position: [1, 2, 3], future: true },
		{ timeTicks: 0, position: [-1, 0, 0] },
	];
	target.value = JSON.stringify(knots);
	find({ node: fields(), id: "p-particle-motion-control-knots" })?.onChange?.({
		target,
	});
	expect(validity).toBe("");
	expect(JSON.parse(text).motion.control.knots).toEqual(knots);
	expect(JSON.parse(text).unknown).toEqual(props().unknown);
});

test("missing values are not generated and invalid JSON/shapes remain in the original textbox", () => {
	let edits = 0;
	for (const text of ["{", "[]", "null", '{"unknown":1e400}']) {
		const node = ProgrammaticParticleFields({
			id: "p",
			state: state({ text }),
			canCompile: true,
			onEdit: () => {
				edits++;
			},
		});
		expect(renderToStaticMarkup(node)).toContain("Fix input props JSON");
		expect(find({ node, id: "p-particle-count" })).toBeUndefined();
	}
	const sparse = ProgrammaticParticleFields({
		id: "p",
		state: state({
			text: '{"motion":{"control":{"mode":"vortex"}},"extra":true}',
		}),
		canCompile: true,
		onEdit: () => {
			edits++;
		},
	});
	expect(
		find({ node: sparse, id: "p-particle-motion-control-axis-0" }),
	).toBeUndefined();
	expect(
		find({ node: sparse, id: "p-particle-motion-control-knots" }),
	).toBeUndefined();
	expect(find({ node: sparse, id: "p-particle-count" })).toBeUndefined();
	const malformed = ProgrammaticParticleFields({
		id: "p",
		state: state({
			text: '{"count":"invalid","rotationSpeed":null,"motion":{"size":null}}',
		}),
		canCompile: true,
		onEdit: () => {
			edits++;
		},
	});
	expect(renderToStaticMarkup(malformed)).toContain("Fix these values");
	expect(edits).toBe(0);
});

test("busy, conflict and unavailable compiler disable controls and ignore direct events", () => {
	for (const patch of [
		{ phase: "loading" },
		{ phase: "compiling" },
		{ phase: "saving" },
		{ conflict: true },
		{},
	] as const) {
		let edits = 0;
		const node = ProgrammaticParticleFields({
			id: "p",
			state: state({ changes: patch }),
			canCompile: Object.keys(patch).length > 0,
			onEdit: () => {
				edits++;
			},
		});
		for (const id of ["count", "motion-control-mode", "motion-control-knots"]) {
			const input = find({ node, id: `p-particle-${id}` });
			expect(input?.disabled).toBe(true);
			input?.onChange?.({ target: { value: "2", valueAsNumber: 2 } });
		}
		expect(edits).toBe(0);
	}
});

test("actual build panel shows fields only for explicit Particle Three and retains the single existing Apply flow", () => {
	for (const [engine, capabilities, visible] of [
		["three", ["particle-surface-v1"], true],
		["three", [], false],
		["three", ["liquid-object-v1"], false],
		["remotion", ["particle-surface-v1"], false],
	] as const) {
		const snapshot = state();
		const build = snapshot.baseline.build as unknown as {
			engine: string;
			capabilities: readonly string[];
		};
		build.engine = engine;
		build.capabilities = capabilities;
		const html = renderToStaticMarkup(
			<ProgrammaticBuildFields
				id="p"
				state={snapshot}
				canLoad={true}
				canCompile={true}
				onEdit={() => {}}
				onSelect={() => {}}
				onRetry={() => {}}
				onApply={() => {}}
				onDiscard={() => {}}
				onCancel={() => {}}
				onFiles={() => {}}
			/>,
		);
		expect(html.includes("Particle fields")).toBe(visible);
		expect(html.match(/Recompile and apply<\/button>/g)?.length).toBe(1);
		expect(html).toContain('id="p-props"');
	}
});

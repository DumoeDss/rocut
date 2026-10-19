import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.EDITOR_MOTION_TEXT_CONTENT_TEST !== "1") {
	test("subtitle timeline content preserves cue and cut boundaries after trim", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, EDITOR_MOTION_TEXT_CONTENT_TEST: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	await import("../../../editor/session/__tests__/wasm-test-mock");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const { mediaTime } = await import("../../../wasm");
	let width = 360;
	const sequence = {
		duration: 600000,
		cues: [
			{
				id: "one",
				text: "Opening line",
				startTime: 0,
				duration: 240000,
				interlude: false,
			},
			{
				id: "two",
				text: "Second line",
				startTime: 240000,
				duration: 240000,
				interlude: false,
			},
			{
				id: "hidden",
				text: "Outside trimmed clip",
				startTime: 480000,
				duration: 120000,
				interlude: false,
			},
		],
		resolvedPlan: {
			cuts: [{ id: "cut", cueId: "two", startTime: 300000, duration: 120000 }],
		},
	};
	mock.module("../../../editor/use-editor", () => ({
		useEditor: () => sequence,
	}));
	mock.module("../../../hooks/use-container-size", () => ({
		useContainerSize: () => ({ width, height: 40 }),
	}));
	const { MotionTextTimelineContent } = await import("../motion-text-content");
	test("shows real cue text with clipped ranges and the resolved cut marker", () => {
		const html = renderToStaticMarkup(
			<MotionTextTimelineContent
				element={{
					type: "motion-text",
					id: "lyrics",
					sequenceId: "sequence",
					name: "Layer name",
					params: {},
					startTime: mediaTime({ ticks: 900000 }),
					duration: mediaTime({ ticks: 360000 }),
					trimStart: mediaTime({ ticks: 120000 }),
					trimEnd: mediaTime({ ticks: 120000 }),
				}}
			/>,
		);
		expect(html).toContain("Opening line</span>");
		expect(html).toContain("Second line</span>");
		expect(html).not.toContain("Outside trimmed clip</span>");
		expect(html).toContain("left:0%;width:33.33333333333333%");
		expect(html).toContain("left:50%");
		expect(html).toContain("border-dashed");
		expect(html).not.toContain("Layer name");
	});

	test("dense cue and cut markers are bounded by clip pixels and recover on zoom", () => {
		const original = structuredClone(sequence);
		sequence.duration = 600000;
		sequence.cues = Array.from({ length: 1000 }, (_, index) => ({
			id: `cue-${index}`,
			text: `Line ${index}`,
			startTime: index * 600,
			duration: 600,
			interlude: false,
		}));
		sequence.resolvedPlan.cuts = sequence.cues.map((cue) => ({
			id: `cut-${cue.id}`,
			cueId: cue.id,
			startTime: cue.startTime + 300,
			duration: 300,
		}));
		const snapshot = structuredClone(sequence);
		const element = {
			type: "motion-text" as const,
			id: "dense",
			sequenceId: "sequence",
			name: "Dense lyrics",
			params: {},
			startTime: mediaTime({ ticks: 900000 }),
			duration: mediaTime({ ticks: 360000 }),
			trimStart: mediaTime({ ticks: 120000 }),
			trimEnd: mediaTime({ ticks: 120000 }),
		};
		const elementSnapshot = structuredClone(element);
		const render = () =>
			renderToStaticMarkup(<MotionTextTimelineContent element={element} />);
		try {
			width = 80;
			const dense = render();
			expect([...dense.matchAll(/data-cue-count=/g)]).toHaveLength(10);
			expect([...dense.matchAll(/data-cut-count=/g)]).toHaveLength(10);
			expect(dense).toContain("Line 200 等 60 条");
			expect(dense).not.toContain("Line 199</span>");
			expect(dense).not.toContain("Line 800</span>");
			width = 6000;
			const expanded = render();
			expect([...expanded.matchAll(/data-cue-count="1"/g)]).toHaveLength(600);
			expect([...expanded.matchAll(/data-cut-count="1"/g)]).toHaveLength(600);
			expect(expanded).toContain("Line 200</span>");
			expect(expanded).toContain("Line 799</span>");
			expect(expanded).not.toContain("Line 800</span>");
			expect(expanded).not.toContain(" 等 ");
			width = 0;
			expect([...render().matchAll(/data-cue-count="600"/g)]).toHaveLength(1);
			expect(sequence).toEqual(snapshot);
			expect(element).toEqual(elementSnapshot);
		} finally {
			Object.assign(sequence, original);
			width = 360;
		}
	});
}

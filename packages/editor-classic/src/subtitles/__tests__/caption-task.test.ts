import { expect, test } from "bun:test";
import {
	createCaptionTaskController,
	type CaptionProcessingState,
} from "../caption-task";

function fixture() {
	const states: CaptionProcessingState[] = [];
	let generation = 0;
	const controller = createCaptionTaskController({
		onChange: (state) => states.push(state),
		captureActivity: () => {
			const started = generation;
			return () => generation === started;
		},
	});
	return {
		controller,
		states,
		invalidate: () => {
			generation += 1;
		},
	};
}

test("only one caption operation is admitted and a cancelled task cannot finish a newer task", () => {
	const { controller, states } = fixture();
	let stops = 0;
	const first = controller.begin({
		step: "loading",
		onCancel: () => {
			stops += 1;
		},
	});
	expect(first).not.toBeNull();
	expect(controller.begin({ step: "duplicate" })).toBeNull();
	controller.cancel();
	controller.cancel();
	expect(stops).toBe(1);
	const next = controller.begin({ step: "new task" });
	const count = states.length;
	first?.updateStep({ step: "stale progress" });
	first?.succeed({ warnings: ["stale"] });
	first?.fail({ error: "stale" });
	expect(first?.isCurrent()).toBe(false);
	expect(states).toHaveLength(count);
	expect(next?.isCurrent()).toBe(true);
	next?.succeed();
	expect(states.at(-1)).toEqual({ status: "idle", error: null, warnings: [] });
});

test("project/activity changes refuse publication even before the lifecycle callback", () => {
	const { controller, states, invalidate } = fixture();
	const task = controller.begin({ step: "reading file" });
	invalidate();
	expect(task?.isCurrent()).toBe(false);
	task?.succeed();
	task?.fail({ error: "late read failure" });
	expect(states).toHaveLength(1);
	controller.cancel();
	expect(controller.begin({ step: "new project" })?.isCurrent()).toBe(true);
});

test("unmount releases owned work once and never publishes into an unmounted panel", () => {
	const { controller, states } = fixture();
	let stops = 0;
	const task = controller.begin({
		step: "inference",
		onCancel: () => {
			stops += 1;
		},
	});
	controller.dispose();
	controller.dispose();
	task?.fail({ error: "cancel rejection" });
	expect(stops).toBe(1);
	expect(states).toHaveLength(1);
	expect(task?.isCurrent()).toBe(false);
	expect(controller.begin({ step: "unmounted" })).toBeNull();
});

test("failure enables a fresh attempt and preserves its warnings", () => {
	const { controller, states } = fixture();
	controller.begin({ step: "bad file" })?.fail({ error: "Invalid subtitle" });
	expect(states.at(-1)).toEqual({
		status: "idle",
		error: "Invalid subtitle",
		warnings: [],
	});
	controller
		.begin({ step: "fixed file" })
		?.succeed({ warnings: ["Skipped cue"] });
	expect(states.at(-1)).toEqual({
		status: "idle",
		error: null,
		warnings: ["Skipped cue"],
	});
});

test("submitted atomic persistence cannot be falsely acknowledged as cancelled", () => {
	const { controller, states } = fixture();
	let stops = 0;
	const task = controller.begin({
		step: "ready",
		onCancel: () => {
			stops += 1;
		},
	});
	expect(task?.beginCommit()).toBe(true);
	controller.cancel();
	expect(stops).toBe(0);
	expect(task?.isCurrent()).toBe(true);
	expect(states.at(-1)).toEqual({
		status: "processing",
		step: "Saving captions...",
		cancellable: false,
	});
	expect(controller.begin({ step: "duplicate" })).toBeNull();
	task?.fail({ error: "Save unavailable" });
	expect(states.at(-1)).toEqual({
		status: "idle",
		error: "Save unavailable",
		warnings: [],
	});
});

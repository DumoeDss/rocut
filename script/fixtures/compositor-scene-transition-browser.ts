import {
	initializeGpu,
	disposeGpu,
	createCompositor,
	disposeCompositor,
	getCompositorCanvasForHandle,
	renderFrameForHandle,
	beginRenderFrameForHandle,
	advanceRenderFrameForHandle,
	commitRenderFrameForHandle,
	cancelRenderFrameForHandle,
	uploadTextureForHandle,
} from "opencut-wasm";
import {
	branch,
	chain,
	frame,
	grayPass,
	group,
	image,
	invalidCases,
	pixelCases,
	transition,
	validCases,
	type Item,
} from "./compositor-scene-transition-cases";

const scope = globalThis as typeof globalThis & {
	__sceneTransitionResult?: unknown;
	__sceneTransitionProgress?: unknown;
};
function check(ok: unknown, message: string): asserts ok {
	if (!ok) throw Error(message);
}
const structured = (error: unknown) =>
	error instanceof Error &&
	error.name === "RenderFrameError" &&
	Reflect.get(error, "code") === "RENDER_FAILED" &&
	error.message.startsWith("Invalid frame descriptor: group preflight");
const syncError = (error: unknown) =>
	typeof error === "string" &&
	error.startsWith("Invalid frame descriptor: group preflight");
const cancelled = (error: unknown) =>
	error instanceof Error &&
	error.name === "AbortError" &&
	Reflect.get(error, "code") === "RENDER_CANCELLED";

async function run() {
	const checks: { name: string; passed: true; actual?: number[] }[] = [];
	scope.__sceneTransitionProgress = checks;
	await initializeGpu();
	const handle = createCompositor(8, 8);
	const expectError = (
		name: string,
		run: () => unknown,
		validate: (error: unknown) => boolean,
	) => {
		let caught: unknown;
		try {
			run();
		} catch (error) {
			caught = error;
		}
		check(
			caught !== undefined && validate(caught),
			`${name}: unexpected rejection ${String(caught)}`,
		);
		checks.push({ name, passed: true });
	};
	const center = () => {
		const canvas = new OffscreenCanvas(8, 8),
			ctx = canvas.getContext("2d")!;
		try {
			ctx.drawImage(getCompositorCanvasForHandle(handle), 0, 0);
			return [...ctx.getImageData(4, 4, 1, 1).data];
		} finally {
			canvas.width = canvas.height = 1;
		}
	};
	const publish = (entry: "begin" | "sync", value: unknown) => {
		if (entry === "sync") return renderFrameForHandle(handle, value);
		const request = beginRenderFrameForHandle(handle, value);
		check(
			advanceRenderFrameForHandle(handle, request, 64),
			"pixel preparation did not complete",
		);
		commitRenderFrameForHandle(handle, request);
	};
	const pixels = (name: string, expected: number[]) => {
		const actual = center();
		check(
			actual.every((value, i) => Math.abs(value - expected[i]!) <= 1),
			`${name}: ${actual}, expected ${expected}`,
		);
		checks.push({ name, passed: true, actual });
	};
	try {
		for (const [name, value] of validCases()) {
			const request = beginRenderFrameForHandle(handle, value);
			try {
				check(
					advanceRenderFrameForHandle(handle, request, 64),
					`${name}: preparation not ready`,
				);
			} finally {
				cancelRenderFrameForHandle(handle, request);
			}
			checks.push({ name, passed: true });
		}
		for (const [name, value] of invalidCases()) {
			expectError(
				`begin/${name}`,
				() => beginRenderFrameForHandle(handle, value),
				structured,
			);
			expectError(
				`sync/${name}`,
				() => renderFrameForHandle(handle, value),
				syncError,
			);
		}
		for (const [name, value] of [
			["branch-is-untagged", frame([transition(group())])],
			[
				"branch-post-field-required",
				frame([transition({ items: [], opacity: 1, blendMode: "normal" })]),
			],
			[
				"progress-field-required",
				frame([
					{ type: "sceneTransition", outgoing: branch(), incoming: branch() },
				]),
			],
		] as const) {
			expectError(
				`begin/${name}`,
				() => beginRenderFrameForHandle(handle, value),
				(error) =>
					error instanceof Error &&
					error.name === "RenderFrameError" &&
					Reflect.get(error, "code") === "RENDER_FAILED" &&
					error.message.startsWith("Invalid frame descriptor:"),
			);
			expectError(
				`sync/${name}`,
				() => renderFrameForHandle(handle, value),
				(error) =>
					typeof error === "string" &&
					error.startsWith("Invalid frame descriptor:"),
			);
		}
		for (const entry of ["begin", "sync"] as const) {
			for (const failure of ["depth", "cycle"] as const) {
				renderFrameForHandle(handle, frame([], [1, 0, 0, 1]));
				const old = beginRenderFrameForHandle(handle, frame([], [0, 0, 1, 1]));
				check(
					advanceRenderFrameForHandle(handle, old, 64),
					"old request was not ready",
				);
				const bad = failure === "depth" ? chain(10000) : transition();
				if (failure === "cycle") (bad.incoming as Item).items = [bad];
				expectError(
					`${entry}/${failure}/reject-new`,
					() =>
						entry === "begin"
							? beginRenderFrameForHandle(handle, frame([bad]))
							: renderFrameForHandle(handle, frame([bad])),
					entry === "begin" ? structured : syncError,
				);
				expectError(
					`${entry}/${failure}/old-request-cannot-publish`,
					() => commitRenderFrameForHandle(handle, old),
					cancelled,
				);
				pixels(`${entry}/${failure}/last-canvas-preserved`, [255, 0, 0, 255]);
			}
		}
		for (const [id, color] of [
			["red", [255, 0, 0, 255]],
			["green", [0, 255, 0, 255]],
			["blue", [0, 0, 255, 255]],
		] as const) {
			const source = new OffscreenCanvas(1, 1);
			try {
				source
					.getContext("2d")!
					.putImageData(
						new ImageData(new Uint8ClampedArray(color), 1, 1),
						0,
						0,
					);
				uploadTextureForHandle(handle, { id, source, width: 1, height: 1 });
			} finally {
				source.width = source.height = 1;
			}
		}
		for (const entry of ["begin", "sync"] as const) {
			for (const progress of [0, 1]) {
				publish(entry, frame([], [1, 0, 0, 1]));
				const hidden = branch([image("missing-inactive-branch")], 0);
				const value = frame([
					progress === 0
						? transition(branch(), hidden, progress)
						: transition(hidden, branch(), progress),
				]);
				expectError(
					`${entry}/progress-${progress}-inactive-zero-opacity-resource-not-skipped`,
					() => publish(entry, value),
					(error) =>
						entry === "begin"
							? error instanceof Error &&
								error.name === "RenderFrameError" &&
								Reflect.get(error, "code") === "RENDER_FAILED" &&
								error.message.includes("missing-inactive-branch")
							: typeof error === "string" &&
								error.includes("missing-inactive-branch"),
				);
				pixels(
					`${entry}/progress-${progress}-failed-resource-preserves-canvas`,
					[255, 0, 0, 255],
				);
			}
			for (const test of pixelCases()) {
				publish(entry, frame(test.items));
				pixels(`${entry}/${test.name}`, test.expected);
			}
			// An independently rendered group is the reference for each branch's
			// post chain. Crossfade must mix complete pictures, not replay effects
			// on the shared green parent or apply opacity to every overlapping child.
			const outgoing = {
				...branch([image("red"), image("red")], 0.5),
				effectPassGroups: [[grayPass]],
			};
			const incoming = branch([image("blue"), image("blue")], 0.5);
			publish(entry, frame([{ type: "group", ...outgoing }]));
			const out = center();
			check(
				Math.abs(out[0]! - out[2]!) <= 1 &&
					Math.abs(out[1]! - out[0]! - 127) <= 2,
				"independent post group must gray red before untouched green parent",
			);
			publish(entry, frame([{ type: "group", ...incoming }]));
			const into = center();
			publish(entry, frame([transition(outgoing, incoming)]));
			pixels(
				`${entry}/post-before-opacity-before-complete-picture-crossfade`,
				out.map((value, i) => Math.round((value + into[i]!) / 2)),
			);
			publish(entry, frame([group([transition()], 1)]));
			pixels(`${entry}/recovery-after-all-rejections`, [0, 255, 0, 255]);
		}
		return {
			passed: true,
			checks,
			actualPublicWasmEntries: true,
			mockAdmission: false,
			dimensions: [8, 8],
			legacyGroupSuite: "Run unchanged compositor-group-preflight separately",
		};
	} finally {
		disposeCompositor(handle);
		disposeGpu();
	}
}
void run().then(
	(result) => {
		scope.__sceneTransitionResult = result;
	},
	(error) => {
		scope.__sceneTransitionResult = {
			passed: false,
			error: String(error?.stack ?? error),
			checks: scope.__sceneTransitionProgress,
		};
	},
);

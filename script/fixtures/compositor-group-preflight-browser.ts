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

type Item = Record<string, unknown>;
const scope = globalThis as typeof globalThis & {
	__groupPreflightResult?: unknown;
	__groupPreflightProgress?: unknown;
};
function check(ok: unknown, message: string): asserts ok {
	if (!ok) throw Error(message);
}
const scene = (): Item => ({ type: "sceneEffect", effectPassGroups: [] });
const group = (items: Item[] = [], opacity = 1): Item => ({
	type: "group",
	items,
	opacity,
	blendMode: "normal",
	effectPassGroups: [],
});
const frame = (items: Item[], color = [0, 0, 0, 1]) => ({
	width: 8,
	height: 8,
	clear: { color },
	items,
});
const chain = (depth: number) => {
	let value = group();
	for (let n = 1; n < depth; n++) value = group([value]);
	return value;
};
const layer = (): Item => ({
	textureId: "unused-during-cpu-preparation",
	opacity: 1,
	blendMode: "normal",
	effectPassGroups: [],
	mask: null,
	transform: {
		centerX: 4,
		centerY: 4,
		width: 8,
		height: 8,
		rotationDegrees: 0,
		flipX: false,
		flipY: false,
	},
});
const invalidInputs = () => {
	const self = group();
	self.items = [self];
	const a = group(),
		b = group([a]);
	a.items = [b];
	const rootCycle = frame([]);
	const child = group(rootCycle.items);
	rootCycle.items.push(child);
	const zeroDeep = chain(10000);
	zeroDeep.opacity = 0;
	const alias = group(Array.from({ length: 2047 }, scene));
	const badArray = new Proxy([] as Item[], {
		get(target, key, receiver) {
			if (key === "length")
				throw Error("caller-owned structural getter failure");
			return Reflect.get(target, key, receiver);
		},
	});
	const pass = { shader: "brightness", uniforms: {} };
	const hugeVector = {
		type: "sceneEffect",
		effectPassGroups: [
			[{ shader: "brightness", uniforms: { values: Array(2100000).fill(0) } }],
		],
	};
	const sharedVector = Array(300000).fill(0);
	const withVector = {
		type: "sceneEffect",
		effectPassGroups: [
			[{ shader: "brightness", uniforms: { values: sharedVector } }],
		],
	};
	const uniformCycle: Record<string, unknown> = {};
	uniformCycle.value = uniformCycle;
	const revoked = Proxy.revocable([] as Item[], {});
	revoked.revoke();
	return [
		["depth-10000", frame([chain(10000)])],
		["opacity-zero-still-checks-depth", frame([zeroDeep])],
		["self-cycle", frame([self])],
		["ancestor-cycle", frame([a])],
		["root-array-cycle", rootCycle],
		["group-count-65-aliases", frame(Array(65).fill(group()))],
		[
			"expanded-items-4097",
			frame([group(Array.from({ length: 4096 }, scene))]),
		],
		["aliased-subtree-counted-twice", frame([group([alias, alias])])],
		[
			"transition-items-counted",
			frame([
				group([
					{
						type: "transition",
						outgoing: Array(4095).fill(layer()),
						incoming: [],
						progress: 0,
					},
				]),
			]),
		],
		["unknown-kind", frame([group(), { type: "unknown" }])],
		["group-items-nonarray", frame([{ ...group(), items: {} }])],
		[
			"group-items-missing",
			frame([
				{
					type: "group",
					opacity: 1,
					blendMode: "normal",
					effectPassGroups: [],
				},
			]),
		],
		["reflect-failure", frame([group(badArray)])],
		["revoked-array-proxy", frame([group(revoked.proxy)])],
		[
			"effect-groups-4097",
			frame([
				{
					...group(),
					effectPassGroups: Array.from({ length: 4097 }, () => []),
				},
			]),
		],
		[
			"effect-passes-4097",
			frame([
				group(),
				{ type: "sceneEffect", effectPassGroups: [Array(4097).fill(pass)] },
			]),
		],
		[
			"transition-effects-global-total",
			frame([
				group(),
				{
					type: "transition",
					progress: 0,
					outgoing: [
						{ ...layer(), effectPassGroups: [Array(2048).fill(pass)] },
					],
					incoming: [
						{ ...layer(), effectPassGroups: [Array(2049).fill(pass)] },
					],
				},
			]),
		],
		["large-uniform-vector-before-serde", frame([group(), hugeVector])],
		[
			"aliased-vectors-counted-per-occurrence",
			frame([group(), withVector, withVector]),
		],
		[
			"large-shader-string-before-serde",
			frame([
				group(),
				{
					type: "sceneEffect",
					effectPassGroups: [[{ shader: "x".repeat(3000000), uniforms: {} }]],
				},
			]),
		],
		[
			"uniform-map-cycle",
			frame([
				group(),
				{
					type: "sceneEffect",
					effectPassGroups: [
						[{ shader: "brightness", uniforms: uniformCycle }],
					],
				},
			]),
		],
		[
			"hidden-map-payload",
			frame([
				group(),
				{
					type: "sceneEffect",
					effectPassGroups: [
						[
							{
								shader: "brightness",
								uniforms: new Map([["values", sharedVector]]),
							},
						],
					],
				},
			]),
		],
	] as const;
};

async function run() {
	const checks: { name: string; passed: true }[] = [];
	scope.__groupPreflightProgress = checks;
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
	const structured = (error: unknown) =>
		error instanceof Error &&
		error.name === "RenderFrameError" &&
		Reflect.get(error, "code") === "RENDER_FAILED" &&
		error.message.startsWith("Invalid frame descriptor: group preflight");
	const cancelled = (error: unknown) =>
		error instanceof Error &&
		error.name === "AbortError" &&
		Reflect.get(error, "code") === "RENDER_CANCELLED";
	const acceptPreparation = (name: string, value: unknown) => {
		const request = beginRenderFrameForHandle(handle, value);
		try {
			check(
				advanceRenderFrameForHandle(handle, request, 64),
				`${name}: empty effects should finish preparation`,
			);
		} finally {
			cancelRenderFrameForHandle(handle, request);
		}
		checks.push({ name, passed: true });
	};
	const center = () => {
		const readback = new OffscreenCanvas(8, 8),
			ctx = readback.getContext("2d")!;
		try {
			ctx.drawImage(getCompositorCanvasForHandle(handle), 0, 0);
			return [...ctx.getImageData(4, 4, 1, 1).data];
		} finally {
			readback.width = readback.height = 1;
		}
	};
	try {
		acceptPreparation("depth-8", frame([chain(8)]));
		acceptPreparation(
			"64-sibling-aliases-are-not-cycles",
			frame(Array(64).fill(group())),
		);
		acceptPreparation(
			"4096-expanded-items",
			frame([group(Array.from({ length: 4095 }, scene))]),
		);
		const alias = group(Array.from({ length: 2046 }, scene));
		acceptPreparation(
			"repeated-nonancestor-subtree-within-budget",
			frame([group([alias, alias])]),
		);
		acceptPreparation(
			"flat-5000-retains-historical-admission",
			frame(Array.from({ length: 5000 }, scene)),
		);
		acceptPreparation(
			"4096-empty-effect-groups",
			frame([
				{
					...group(),
					effectPassGroups: Array.from({ length: 4096 }, () => []),
				},
			]),
		);
		acceptPreparation(
			"4096-effect-passes",
			frame([
				{
					...group(),
					effectPassGroups: [
						Array(4096).fill({ shader: "brightness", uniforms: {} }),
					],
				},
			]),
		);
		acceptPreparation(
			"transition-layers-at-expanded-boundary",
			frame([
				group([
					{
						type: "transition",
						outgoing: Array(4094).fill(layer()),
						incoming: [],
						progress: 0,
					},
				]),
			]),
		);
		for (const [name, value] of invalidInputs()) {
			expectError(
				`begin/${name}`,
				() => beginRenderFrameForHandle(handle, value),
				structured,
			);
			expectError(
				`sync/${name}`,
				() => renderFrameForHandle(handle, value),
				(error) =>
					typeof error === "string" &&
					error.startsWith("Invalid frame descriptor: group preflight"),
			);
		}
		// Exercise actual public request state, not a helper/mock admission. A bad
		// newer descriptor must invalidate the already-ready blue request first.
		for (const entry of ["begin", "sync"] as const) {
			for (const invalid of ["depth", "cycle"] as const) {
				renderFrameForHandle(handle, frame([], [1, 0, 0, 1]));
				const old = beginRenderFrameForHandle(handle, frame([], [0, 0, 1, 1]));
				check(
					advanceRenderFrameForHandle(handle, old, 64),
					"old frame was not ready",
				);
				const bad = invalid === "depth" ? chain(10000) : group();
				if (invalid === "cycle") bad.items = [bad];
				expectError(
					`${entry}/${invalid}/reject-new`,
					() =>
						entry === "begin"
							? beginRenderFrameForHandle(handle, frame([bad]))
							: renderFrameForHandle(handle, frame([bad])),
					entry === "begin"
						? structured
						: (error) =>
								typeof error === "string" && error.includes("group preflight"),
				);
				expectError(
					`${entry}/${invalid}/old-request-cannot-publish`,
					() => commitRenderFrameForHandle(handle, old),
					cancelled,
				);
				check(
					JSON.stringify(center()) === JSON.stringify([255, 0, 0, 255]),
					"rejected frame changed the last published canvas",
				);
			}
		}
		const recovery = beginRenderFrameForHandle(
			handle,
			frame([group()], [0, 1, 0, 1]),
		);
		check(
			advanceRenderFrameForHandle(handle, recovery, 64),
			"recovery did not prepare",
		);
		commitRenderFrameForHandle(handle, recovery);
		check(
			JSON.stringify(center()) === JSON.stringify([0, 255, 0, 255]),
			"recovery failed to publish",
		);
		checks.push({
			name: "valid-group-recovery-after-all-rejections",
			passed: true,
		});
		const blue = new OffscreenCanvas(1, 1);
		try {
			blue
				.getContext("2d")!
				.putImageData(
					new ImageData(new Uint8ClampedArray([0, 0, 255, 255]), 1, 1),
					0,
					0,
				);
			uploadTextureForHandle(handle, {
				id: "blue",
				source: blue,
				width: 1,
				height: 1,
			});
			const blueLayer = { ...layer(), type: "layer", textureId: "blue" };
			const nested = group([group([blueLayer, blueLayer])], 0.5);
			renderFrameForHandle(handle, frame([nested], [0, 1, 0, 1]));
			const actual = center(),
				expected = [0, 127, 128, 255];
			check(
				actual.every((value, index) => Math.abs(value - expected[index]!) <= 1),
				`nested isolated once-opacity pixel ${actual}`,
			);
			checks.push({
				name: "nested-group-real-pixels-and-once-opacity-over-parent",
				passed: true,
			});
		} finally {
			blue.width = blue.height = 1;
		}
		return {
			passed: true,
			checks,
			actualPublicWasmEntries: true,
			mockAdmission: false,
			dimensions: [8, 8],
		};
	} finally {
		disposeCompositor(handle);
		disposeGpu();
	}
}
void run().then(
	(result) => {
		scope.__groupPreflightResult = result;
	},
	(error) => {
		scope.__groupPreflightResult = {
			passed: false,
			error: String(error?.stack ?? error),
			checks: scope.__groupPreflightProgress,
		};
	},
);

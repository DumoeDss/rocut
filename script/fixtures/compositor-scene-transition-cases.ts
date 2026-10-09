export type Item = Record<string, unknown>;
export const effect = (): Item => ({
	type: "sceneEffect",
	effectPassGroups: [],
});
export const branch = (items: Item[] = [], opacity = 1): Item => ({
	items,
	opacity,
	blendMode: "normal",
	effectPassGroups: [],
});
export const group = (items: Item[] = [], opacity = 1): Item => ({
	type: "group",
	...branch(items, opacity),
});
export const transition = (
	outgoing = branch(),
	incoming = branch(),
	progress = 0.5,
): Item => ({
	type: "sceneTransition",
	outgoing,
	incoming,
	progress,
});
export const frame = (items: Item[], color = [0, 1, 0, 1]) => ({
	width: 8,
	height: 8,
	clear: { color },
	items,
});
export const layer = (textureId = "unused-during-preparation"): Item => ({
	textureId,
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
export const image = (id: string): Item => ({ type: "layer", ...layer(id) });
export function chain(depth: number): Item {
	let value = transition();
	for (let n = 1; n < depth; n++) value = transition(branch([value]));
	return value;
}
const pass = { shader: "brightness", uniforms: {} };
const passes = (count: number) => ({
	...branch(),
	effectPassGroups: [Array(count).fill(pass)],
});
const passGroups = (count: number) => ({
	...branch(),
	effectPassGroups: Array.from({ length: count }, () => []),
});
const legacy = (count: number): Item => ({
	type: "transition",
	outgoing: Array(count).fill(layer()),
	incoming: [],
	progress: 0,
});
export function validCases(): [string, unknown][] {
	const shared = branch(Array.from({ length: 2046 }, effect));
	const withDeepVector = chain(8);
	let deepest = withDeepVector;
	for (let n = 1; n < 8; n++)
		deepest = (deepest.outgoing as { items: Item[] }).items[0]!;
	(deepest.outgoing as Item).effectPassGroups = [
		[{ ...pass, uniforms: { values: [1, 2, 3, 4] } }],
	];
	return [
		["root-transition-without-tagged-groups", frame([transition()])],
		["eight-transition-branch-depth-with-deep-vector", frame([withDeepVector])],
		[
			"64-branch-groups-with-sibling-aliases",
			frame(Array(32).fill(transition())),
		],
		[
			"4096-expanded-items-including-both-branches",
			frame([transition(branch(Array.from({ length: 4093 }, effect)))]),
		],
		[
			"repeated-branch-subtree-within-budget",
			frame([transition(shared, shared)]),
		],
		[
			"4096-effect-pass-groups-across-branches",
			frame([transition(passGroups(2048), passGroups(2048))]),
		],
		[
			"4096-effect-passes-across-branches",
			frame([transition(passes(2048), passes(2048))]),
		],
		[
			"legacy-transition-inside-branch-at-item-boundary",
			frame([transition(branch([legacy(4092)]))]),
		],
	];
}
export function invalidCases(): [string, unknown][] {
	const self = transition();
	(self.outgoing as Item).items = [self];
	const first = transition(),
		second = transition(branch([first]));
	(first.incoming as Item).items = [second];
	const rootCycle = frame([]);
	rootCycle.items.push(transition(branch(rootCycle.items)));
	const shared = branch(Array.from({ length: 2047 }, effect));
	const opaqueZero = chain(10000);
	(opaqueZero.outgoing as Item).opacity = 0;
	const revoked = Proxy.revocable([] as Item[], {});
	revoked.revoke();
	const mapCycle: Item = {};
	mapCycle.values = mapCycle;
	const huge = (uniforms: unknown): Item => ({
		...branch(),
		effectPassGroups: [[{ ...pass, uniforms }]],
	});
	const aliasVector = Array(300000).fill(0);
	const withAlias = huge({ values: aliasVector });
	return [
		[
			"root-only-transition-triggers-item-admission",
			frame([transition(), ...Array.from({ length: 4096 }, effect)]),
		],
		["10000-branch-depth", frame([chain(10000)])],
		["opacity-zero-does-not-skip-depth", frame([opaqueZero])],
		[
			"progress-zero-does-not-skip-incoming",
			frame([transition(branch(), branch([chain(10000)]), 0)]),
		],
		[
			"progress-one-does-not-skip-outgoing",
			frame([transition(branch([chain(10000)]), branch(), 1)]),
		],
		["transition-self-cycle", frame([self])],
		["transition-mutual-cycle", frame([first])],
		["branch-root-array-cycle", rootCycle],
		[
			"66-branch-groups-with-sibling-aliases",
			frame(Array(33).fill(transition())),
		],
		[
			"4097-expanded-items-including-both-branches",
			frame([transition(branch(Array.from({ length: 4094 }, effect)))]),
		],
		["repeated-branch-is-counted-twice", frame([transition(shared, shared)])],
		[
			"legacy-transition-layers-counted-in-branch",
			frame([transition(branch([legacy(4093)]))]),
		],
		[
			"outgoing-must-be-a-group-not-legacy-array",
			frame([transition([] as unknown as Item)]),
		],
		[
			"incoming-missing",
			frame([{ type: "sceneTransition", outgoing: branch(), progress: 0 }]),
		],
		[
			"branch-items-must-be-an-array",
			frame([transition({ ...branch(), items: {} })]),
		],
		["revoked-branch-items-proxy", frame([transition(branch(revoked.proxy))])],
		[
			"4097-effect-pass-groups-across-branches",
			frame([transition(passGroups(2048), passGroups(2049))]),
		],
		[
			"4097-effect-passes-across-branches",
			frame([transition(passes(2048), passes(2049))]),
		],
		[
			"root-sibling-effects-share-transition-budget",
			frame([
				transition(passes(4096)),
				{ type: "sceneEffect", effectPassGroups: [[pass]] },
			]),
		],
		[
			"large-vector-in-inactive-branch",
			frame([
				transition(branch(), huge({ values: Array(2100000).fill(0) }), 0),
			]),
		],
		[
			"aliased-vector-expanded-per-branch",
			frame([transition(withAlias, withAlias)]),
		],
		[
			"large-shader-in-branch",
			frame([
				transition({
					...branch(),
					effectPassGroups: [[{ shader: "x".repeat(3000000), uniforms: {} }]],
				}),
			]),
		],
		["uniform-map-cycle-in-branch", frame([transition(huge(mapCycle))])],
		[
			"hidden-map-payload-in-branch",
			frame([transition(huge(new Map([["values", aliasVector]])))]),
		],
	];
}

export const grayPass = {
	shader: "color-adjustment",
	uniforms: {
		exposure: 0,
		contrast: 0,
		saturation: -100,
		temperature: 0,
		tint: 0,
	},
};
export function pixelCases(): {
	name: string;
	items: Item[];
	expected: number[];
}[] {
	const blue = branch([image("blue"), image("blue")], 0.5);
	const red = branch([image("red"), image("red")], 0.5);
	return [
		...([0, 0.5, 1] as const).map((progress) => ({
			name: `independent-parent-once-opacity-progress-${progress}`,
			items: [transition(blue, red, progress)],
			expected: [
				Math.round(128 * progress),
				127,
				Math.round(128 * (1 - progress)),
				255,
			],
		})),
		{
			name: "branch-blend-modes-use-the-same-parent",
			items: [
				transition(
					{ ...branch([image("blue")]), blendMode: "multiply" },
					{ ...branch([image("red")]), blendMode: "screen" },
				),
			],
			expected: [128, 128, 0, 255],
		},
		{
			name: "child-multiply-remains-isolated",
			items: [
				transition(
					branch([{ ...image("red"), blendMode: "multiply" }]),
					branch([{ ...image("red"), blendMode: "multiply" }]),
				),
			],
			expected: [255, 0, 0, 255],
		},
		{
			name: "empty-branch-post-cannot-touch-parent",
			items: [
				transition({ ...branch(), effectPassGroups: [[grayPass]] }, branch()),
			],
			expected: [0, 255, 0, 255],
		},
		{
			name: "nested-transition-inside-outer-group",
			items: [
				group(
					[transition(branch([image("blue")]), branch([image("red")]), 0.5)],
					0.5,
				),
			],
			expected: [64, 127, 64, 255],
		},
		{
			name: "following-sibling-is-not-affected",
			items: [transition(blue, red), image("green")],
			expected: [0, 255, 0, 255],
		},
	];
}

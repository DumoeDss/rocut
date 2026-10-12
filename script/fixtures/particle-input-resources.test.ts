import { test, expect } from "bun:test";
import { inflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { particleAlphaPng, particlePoseGlb } from "./particle-input-resources";

test("2x2 RGBA fixture contains explicit opaque, half-alpha and transparent pixels", () => {
	const png = particleAlphaPng();
	expect(png.readUInt32BE(16)).toBe(2);
	expect(png.readUInt32BE(20)).toBe(2);
	const data = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
	expect([...data]).toEqual([
		0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 128, 255, 255, 255, 0,
	]);
});

const toolchain = process.env.ROCUT_TEST_PARTICLE_INPUT_TOOLCHAIN;
test.skipIf(!toolchain)(
	"shared verified model loading and animation feed the real Particle CPU pose snapshot",
	async () => {
		const assets = await import(
			pathToFileURL(
				`${toolchain}/node_modules/@elftia/three-assets/dist/index.js`,
			).href
		);
		const THREE = await import(
			pathToFileURL(`${toolchain}/node_modules/three/build/three.module.js`)
				.href
		);
		const { createParticlePose } = await import(
			pathToFileURL(
				"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/particle-pose-geometry.mjs",
			).href
		);
		const bytes = particlePoseGlb(),
			body = bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			);
		const model = await assets.loadModel(
			{
				id: "pose.glb",
				mediaType: "model/gltf-binary",
				byteLength: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			},
			{
				resolver: {
					read: async (id: string) => {
						expect(id).toBe("pose.glb");
						return body.slice(0);
					},
				},
				limits: {
					maxBytes: 100000,
					maxDecodedBytes: 1000000,
					maxDimension: 4096,
					maxObjects: 4096,
				},
			},
		);
		const instance = model.createInstance(),
			animation = assets.createModelAnimation(instance, {
				clip: "pose",
				mode: "clamp",
			}),
			pose = createParticlePose(THREE, instance.value);
		try {
			const read = (time: number) => {
				animation.seek(time);
				pose.update();
				const source = instance.value.getObjectByName("surface"),
					snapshot = pose.root.children[0];
				return {
					nodeX: source.position.x,
					jointY: instance.value.getObjectByName("joint").position.y,
					morph: source.morphTargetInfluences[0],
					positions: [...snapshot.geometry.attributes.position.array],
					matrix: [...snapshot.matrix.elements],
				};
			};
			const middle = read(0.5);
			expect(middle.nodeX).toBeCloseTo(0.25);
			expect(middle.jointY).toBeCloseTo(0.125);
			expect(middle.morph).toBeCloseTo(0.5);
			expect(middle.positions[8]).toBeCloseTo(0.5);
			expect(middle.positions[1]).toBeCloseTo(0.125);
			expect(middle.matrix[12]).toBeCloseTo(0.25);
			expect(read(1).positions).not.toEqual(middle.positions);
			expect(read(0.5)).toEqual(middle);
			expect(
				pose.root.children[0].geometry.attributes.skinIndex,
			).toBeUndefined();
			expect(pose.root.children[0].geometry.morphAttributes).toEqual({});
		} finally {
			pose.dispose();
			animation.dispose();
			instance.dispose();
			model.dispose();
		}
	},
);
test.skipIf(!toolchain)(
	"real GLTFLoader decodes fixture node, skin and morph animation tracks",
	async () => {
		const loader = await import(
			pathToFileURL(
				`${toolchain}/node_modules/three/examples/jsm/loaders/GLTFLoader.js`,
			).href
		);
		const bytes = particlePoseGlb();
		const gltf = await new loader.GLTFLoader().parseAsync(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
			"",
		);
		expect(gltf.animations[0].name).toBe("pose");
		expect(
			gltf.animations[0].tracks.map((track: { name: string }) => track.name),
		).toEqual([
			"surface.position",
			"joint.position",
			"surface.morphTargetInfluences",
		]);
		const mesh = gltf.scene.children.find(
			(node: { isSkinnedMesh?: boolean }) => node.isSkinnedMesh,
		);
		expect(mesh).toBeDefined();
		expect(mesh.morphTargetInfluences).toEqual([0]);
		expect(mesh.skeleton.bones).toHaveLength(1);
	},
);

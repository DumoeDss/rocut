import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { extractThreeSurface } from "../programmatic/engines/three-surface-extract";

const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN;
const THREE = toolchain
	? await import(
			pathToFileURL(join(toolchain, "node_modules/three/build/three.module.js"))
				.href
		)
	: undefined;
const check = test.skipIf(!THREE);
function geometry(indexed = false) {
	const g = new THREE.BufferGeometry();
	g.setAttribute(
		"position",
		new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
	);
	if (indexed) g.setIndex([0, 1, 2]);
	return g;
}
const mesh = (g = geometry(), material = new THREE.MeshBasicMaterial()) =>
	new THREE.Mesh(g, material);
function approx(actual: number[], expected: number[]) {
	expect(actual.length).toBe(expected.length);
	actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 10));
}

check("uses the real pinned Three 0.185.1 without a renderer", async () => {
	const pkg = JSON.parse(
		await readFile(join(toolchain!, "node_modules/three/package.json"), "utf8"),
	);
	expect(pkg.version).toBe("0.185.1");
	expect(THREE.REVISION).toBe("185");
});

check(
	"extracts indexed and non-indexed triangles without screen-area filtering",
	() => {
		for (const indexed of [false, true]) {
			const object = mesh(geometry(indexed));
			object.matrixAutoUpdate = false;
			object.matrix.set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);
			const result = extractThreeSurface(object);
			expect(result.triangles).toHaveLength(1);
			approx(result.triangles[0].position.flat(), [0, 0, 0, 0, 0, -1, 0, 1, 0]);
			expect(result.triangles[0].normal).toBeUndefined();
			expect(result.materials[0]).toBe(object.material);
			expect(result.primitives[0]).toMatchObject({
				mesh: object,
				groupIndex: null,
				materialSlot: 0,
				materialIndex: 0,
				triangleStart: 0,
				triangleCount: 1,
			});
		}
	},
);

check(
	"composes ancestor transforms and inverse-transpose normals without mutations",
	() => {
		const parent = new THREE.Group(),
			object = mesh();
		parent.position.set(10, 0, 0);
		parent.scale.set(2, 3, 4);
		object.position.set(1, 2, 3);
		object.rotation.z = Math.PI / 2;
		object.geometry.setAttribute(
			"normal",
			new THREE.Float32BufferAttribute([1, 1, 0, 1, 1, 0, 1, 1, 0], 3),
		);
		parent.add(object);
		const snapshot = () =>
			JSON.stringify([
				parent.matrix.elements,
				parent.matrixWorld.elements,
				object.matrix.elements,
				object.matrixWorld.elements,
				object.normalMatrix.elements,
				parent.matrixWorldNeedsUpdate,
				object.matrixWorldNeedsUpdate,
				Array.from(object.geometry.attributes.position.array),
				Array.from(object.geometry.attributes.normal.array),
				object.geometry.groups,
				object.geometry.drawRange,
				object.material.version,
			]);
		const before = snapshot(),
			result = extractThreeSurface(object);
		expect(snapshot()).toBe(before);
		approx(
			result.triangles[0].position.flat(),
			[12, 6, 12, 12, 9, 12, 10, 6, 12],
		);
		for (const normal of result.triangles[0].normal!)
			approx(normal, [-3 / Math.sqrt(13), 2 / Math.sqrt(13), 0]);
	},
);

check(
	"respects explicit local/world matrices and mirrored normal transforms",
	() => {
		const object = mesh();
		object.matrixAutoUpdate = false;
		object.matrix.makeScale(-2, 3, 4);
		object.geometry.setAttribute(
			"normal",
			new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3),
		);
		let result = extractThreeSurface(object);
		expect(result.triangles[0].position[2]).toEqual([-2, 0, 0]);
		expect(result.triangles[0].normal![0]).toEqual([-1, 0, 0]);
		object.matrixWorldAutoUpdate = false;
		object.matrixWorld.makeTranslation(7, 8, 9);
		result = extractThreeSurface(object);
		expect(result.triangles[0].position[0]).toEqual([7, 8, 9]);
	},
);

check(
	"preserves linear RGB/RGBA, normalized buffers and interleaved UV",
	() => {
		const object = mesh(),
			g = object.geometry;
		const uv = new THREE.InterleavedBuffer(
			new Float32Array([9, 0, 0, 9, 1, 0, 9, 0, 1]),
			3,
		);
		g.setAttribute("uv", new THREE.InterleavedBufferAttribute(uv, 2, 1));
		g.setAttribute(
			"color",
			new THREE.Uint8BufferAttribute(
				[128, 64, 255, 0, 255, 128, 255, 255, 255],
				3,
				true,
			),
		);
		object.material.color.setRGB(0.1, 0.2, 0.3);
		object.material.opacity = 0.25;
		let result = extractThreeSurface(object);
		expect(result.triangles[0].uv).toEqual([
			[0, 0],
			[1, 0],
			[0, 1],
		]);
		expect(result.triangles[0].color![0]).toEqual([128 / 255, 64 / 255, 1, 1]);
		g.setAttribute(
			"color",
			new THREE.Float32BufferAttribute(
				[0.25, 0.5, 1, 0.5, 0, 1, 0, 0, 1, 0, 0, 1],
				4,
			),
		);
		result = extractThreeSurface(object);
		expect(result.triangles[0].color![0]).toEqual([0.25, 0.5, 1, 0.5]);
		expect(result.materials[0]).toBe(object.material);
	},
);

check(
	"returns stable primitive/material bindings for groups intersected with drawRange",
	() => {
		const g = geometry(true),
			a = new THREE.MeshBasicMaterial(),
			b = new THREE.MeshBasicMaterial();
		g.setIndex([0, 1, 2, 2, 1, 0, 0, 2, 1]);
		g.addGroup(0, 3, 1);
		g.addGroup(3, 3, 0);
		g.addGroup(6, 3, 1);
		g.setDrawRange(3, 6);
		const root = new THREE.Group(),
			first = mesh(g, [a, b]),
			second = mesh(geometry(), a);
		root.add(first, second);
		const result = extractThreeSurface(root),
			again = extractThreeSurface(root);
		expect(result.materials).toEqual([a, b]);
		expect(
			result.triangles.map((t) => [t.primitiveIndex, t.materialIndex]),
		).toEqual([
			[0, 0],
			[1, 1],
			[2, 0],
		]);
		expect(
			result.primitives.map((p) => [
				p.groupIndex,
				p.materialSlot,
				p.triangleStart,
				p.triangleCount,
			]),
		).toEqual([
			[1, 0, 0, 1],
			[2, 1, 1, 1],
			[null, 0, 2, 1],
		]);
		expect(again.triangles).toEqual(result.triangles);
		expect(again.materials[0]).toBe(result.materials[0]);
		first.material = a;
		expect(extractThreeSurface(first).primitives).toHaveLength(1); // Single-material draws ignore groups.
	},
);

check("respects object, ancestor and per-group material visibility", () => {
	const root = new THREE.Group(),
		hidden = new THREE.Group(),
		object = mesh();
	hidden.visible = false;
	hidden.add(new THREE.Line());
	root.add(hidden, object);
	expect(extractThreeSurface(root).triangles).toHaveLength(1);
	object.material.visible = false;
	expect(extractThreeSurface(root).triangles).toHaveLength(0);
	object.material.visible = true;
	root.visible = false;
	expect(extractThreeSurface(object).triangles).toHaveLength(0);
});

check("does not read texture pixels or evaluate material callbacks", () => {
	const object = mesh(),
		texture = new THREE.Texture();
	Object.defineProperty(texture, "image", {
		get() {
			throw Error("texture pixels read");
		},
	});
	object.material.map = texture;
	object.onBeforeRender = () => {
		throw Error("render callback executed");
	};
	expect(extractThreeSurface(object).materials[0]).toBe(object.material);
});

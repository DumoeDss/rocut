import { expect, test } from "bun:test";
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
check(
	"rejects unsupported dynamic and non-triangle drawables explicitly",
	() => {
		for (const object of [
			new THREE.SkinnedMesh(geometry(), new THREE.MeshBasicMaterial()),
			new THREE.InstancedMesh(geometry(), new THREE.MeshBasicMaterial(), 1),
			new THREE.Line(geometry()),
			new THREE.Points(geometry()),
			new THREE.Sprite(),
			new THREE.LOD(),
		]) {
			expect(() => extractThreeSurface(object)).toThrow(
				"unsupported dynamic or non-triangle",
			);
		}
		const object = mesh();
		object.morphTargetInfluences = [0];
		expect(extractThreeSurface(object).triangles).toHaveLength(1);
		object.morphTargetInfluences = [0.5];
		expect(() => extractThreeSurface(object)).toThrow("morph");
		object.morphTargetInfluences = [NaN];
		expect(() => extractThreeSurface(object)).toThrow("morph");
	},
);

check("rejects singular/projective transforms and invalid normals", () => {
	const object = mesh();
	object.scale.z = 0;
	expect(() => extractThreeSurface(object)).toThrow("singular");
	object.scale.z = 1;
	object.matrixAutoUpdate = false;
	object.matrix.elements[3] = 0.1;
	expect(() => extractThreeSurface(object)).toThrow("affine");
	object.matrix.identity();
	for (const normal of [
		[0, 0, 0],
		[NaN, 0, 1],
	]) {
		object.geometry.setAttribute(
			"normal",
			new THREE.Float32BufferAttribute([...normal, ...normal, ...normal], 3),
		);
		expect(() => extractThreeSurface(object)).toThrow("vertex normal");
	}
});

check(
	"rejects malformed indices, attributes, colors and incomplete triangle ranges",
	() => {
		for (const alter of [
			(g: any) => g.setIndex([0, 1, 99]),
			(g: any) =>
				g.setAttribute(
					"position",
					new THREE.Float32BufferAttribute([NaN, 0, 0, 1, 0, 0, 0, 1, 0], 3),
				),
			(g: any) =>
				g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0], 2)),
			(g: any) =>
				g.setAttribute(
					"color",
					new THREE.Float32BufferAttribute([2, 0, 0, 1, 1, 1, 0, 0, 0], 3),
				),
			(g: any) => g.setDrawRange(0, 2),
			(g: any) => g.setDrawRange(1, 2),
		]) {
			const object = mesh();
			alter(object.geometry);
			expect(() => extractThreeSurface(object)).toThrow("Three surface:");
		}
	},
);

check(
	"rejects missing material bindings and unsupported wireframe/deformation",
	() => {
		const object = mesh(geometry(), [new THREE.MeshBasicMaterial()]);
		object.geometry.addGroup(0, 3, 1);
		expect(() => extractThreeSurface(object)).toThrow("material");
		object.material = new THREE.MeshBasicMaterial({ wireframe: true });
		expect(() => extractThreeSurface(object)).toThrow("wireframe");
		object.material.wireframe = false;
		object.material.displacementMap = new THREE.Texture();
		expect(() => extractThreeSurface(object)).toThrow("displaced");
	},
);

check(
	"admits bounds before attribute reads and never returns partial geometry",
	() => {
		const object = mesh(geometry(true));
		object.geometry.setIndex([0, 1, 2, 0, 1, 2]);
		object.geometry.attributes.position.getX = () => {
			throw Error("vertex read before admission");
		};
		expect(() => extractThreeSurface(object, { maxTriangles: 1 })).toThrow(
			"triangle limit",
		);
		expect(() =>
			extractThreeSurface(object, { maxWorkingBytes: 65536 }),
		).toThrow("working-byte");
		expect(() => extractThreeSurface(object, { maxGeometryBytes: 1 })).toThrow(
			"geometry-byte",
		);
		expect(() => extractThreeSurface(object, { maxTriangles: 262145 })).toThrow(
			"invalid limit",
		);
		const root = new THREE.Group();
		root.add(mesh(), mesh(geometry(true)));
		root.children[1].geometry.setIndex([0, 1, 99]);
		let returned: unknown;
		expect(() => {
			returned = extractThreeSurface(root);
		}).toThrow("out of range");
		expect(returned).toBeUndefined();
		expect(() => extractThreeSurface(root, { maxObjects: 2 })).toThrow(
			"object limit",
		);
	},
);

check(
	"rejects cycles and shared mutable backing stores without touching source",
	() => {
		const root = new THREE.Group();
		root.children.push(root);
		root.parent = root;
		expect(() => extractThreeSurface(root)).toThrow("cyclic");
		const object = mesh();
		object.geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(new Float32Array(new SharedArrayBuffer(36)), 3),
		);
		expect(() => extractThreeSurface(object)).toThrow("shared mutable");
	},
);

check(
	"retains front-face and corner attribute correspondence under mirrored transforms",
	() => {
		const object = mesh();
		object.scale.x = -1;
		object.geometry.setAttribute(
			"uv",
			new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2),
		);
		object.geometry.setAttribute(
			"color",
			new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3),
		);
		let triangle = extractThreeSurface(object).triangles[0];
		expect(triangle.position).toEqual([
			[0, 0, 0],
			[0, 1, 0],
			[-1, 0, 0],
		]);
		expect(triangle.uv).toEqual([
			[0, 0],
			[0, 1],
			[1, 0],
		]);
		expect(triangle.color).toEqual([
			[1, 0, 0, 1],
			[0, 0, 1, 1],
			[0, 1, 0, 1],
		]);
		const [a, b, c] = triangle.position;
		const edge1 = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
		const edge2 = new THREE.Vector3(...c).sub(new THREE.Vector3(...a));
		const geometricNormal = edge1
			.cross(edge2)
			.normalize()
			.toArray()
			.map((value: number) => (value === 0 ? 0 : value));
		expect(geometricNormal).toEqual([0, 0, 1]);
		expect(triangle.normal).toBeUndefined();
		object.geometry.computeVertexNormals();
		triangle = extractThreeSurface(object).triangles[0];
		for (const normal of triangle.normal!)
			expect(normal.map((value) => (value === 0 ? 0 : value))).toEqual(
				geometricNormal,
			);
	},
);

check(
	"accepts triangle draws starting at arbitrary element offsets including group intersections",
	() => {
		const g = geometry(true);
		g.setIndex([2, 0, 1, 2]);
		g.setDrawRange(1, 3);
		const object = mesh(g);
		expect(extractThreeSurface(object).triangles[0].position).toEqual([
			[0, 0, 0],
			[1, 0, 0],
			[0, 1, 0],
		]);
		object.material = [object.material];
		g.addGroup(0, 4, 0);
		const result = extractThreeSurface(object);
		expect(result.triangles).toHaveLength(1);
		expect(result.primitives[0].groupIndex).toBe(0);
		expect(result.triangles[0].position).toEqual([
			[0, 0, 0],
			[1, 0, 0],
			[0, 1, 0],
		]);
	},
);

check(
	"rejects sparse morph influences instead of treating holes as zero",
	() => {
		const object = mesh();
		object.morphTargetInfluences = Array(1);
		expect(() => extractThreeSurface(object)).toThrow("morph");
		const g = geometry();
		g.morphAttributes.position = [g.attributes.position.clone()];
		const realMorph = mesh(g);
		expect(realMorph.morphTargetInfluences).toEqual([0]);
		expect(extractThreeSurface(realMorph).triangles).toHaveLength(1);
		delete realMorph.morphTargetInfluences[0];
		expect(() => extractThreeSurface(realMorph)).toThrow("morph");
	},
);

check(
	"rejects programmable vertex materials and instance/prototype compilation hooks",
	() => {
		for (const material of [
			new THREE.ShaderMaterial(),
			new THREE.RawShaderMaterial(),
		])
			expect(() => extractThreeSurface(mesh(geometry(), material))).toThrow(
				"vertex shaders",
			);
		const material = new THREE.MeshBasicMaterial();
		material.onBeforeCompile = () => {};
		expect(() => extractThreeSurface(mesh(geometry(), material))).toThrow(
			"onBeforeCompile",
		);
		class CustomMaterial extends THREE.MeshBasicMaterial {
			onBeforeCompile() {}
		}
		expect(() =>
			extractThreeSurface(mesh(geometry(), new CustomMaterial())),
		).toThrow("onBeforeCompile");
	},
);

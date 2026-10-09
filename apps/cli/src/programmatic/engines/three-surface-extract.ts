import { extractSurfaceVertices } from "./three-surface-vertices";
import type {
	Attribute,
	Matrix,
	SurfacePlan,
	ThreeSurfaceLimits,
	ThreeSurfaceMaterial,
	ThreeSurfaceObject,
	ThreeSurfacePrimitive,
} from "./three-surface-types";
export type {
	ThreeSurfaceLimits,
	ThreeSurfaceMaterial,
	ThreeSurfaceObject,
	ThreeSurfacePrimitive,
	ThreeSurfaceTriangle,
} from "./three-surface-types";
const CAPS = Object.freeze({
	maxTriangles: 262_144,
	maxWorkingBytes: 32 * 1024 * 1024,
	maxObjects: 4096,
	maxGeometryBytes: 32 * 1024 * 1024,
});
const fail = (reason: string): never => {
	throw Error(`Three surface: ${reason}`);
};
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const finite = (values: readonly number[]) => values.every(Number.isFinite);
function world(object: ThreeSurfaceObject, parent?: Matrix): Matrix {
	const local = object.matrix.clone();
	if (object.matrixAutoUpdate)
		local.compose(object.position, object.quaternion, object.scale);
	const result = !object.matrixWorldAutoUpdate
		? object.matrixWorld.clone()
		: parent
			? local.clone().multiplyMatrices(parent, local)
			: local;
	const e = result.elements;
	if (
		e.length !== 16 ||
		!finite(e) ||
		e[3] !== 0 ||
		e[7] !== 0 ||
		e[11] !== 0 ||
		e[15] !== 1
	)
		fail("world transform must be finite and affine");
	return result;
}
function range(start: number, count: number, total: number): [number, number] {
	if (
		!integer(start) ||
		(count !== Infinity && (!integer(count) || !integer(start + count)))
	)
		fail("invalid draw range/group");
	return [Math.min(start, total), Math.min(start + count, total)];
}
function staticMaterial(material: ThreeSurfaceMaterial) {
	// The pinned runtime's base prototypes are trusted; reject instance/subclass hooks.
	if (material.isShaderMaterial || material.isRawShaderMaterial)
		fail("custom vertex shaders are unsupported");
	let declarations = 0,
		depth = 0;
	for (
		let prototype: object | null = material;
		prototype;
		prototype = Object.getPrototypeOf(prototype)
	) {
		if (++depth > 32) fail("material prototype limit exceeded");
		const hook = Object.getOwnPropertyDescriptor(prototype, "onBeforeCompile");
		if (
			hook &&
			(prototype === material ||
				++declarations > 1 ||
				typeof hook.value !== "function")
		)
			fail("custom onBeforeCompile hooks are unsupported");
	}
	if (declarations !== 1) fail("unsupported material compilation protocol");
}

/**
 * Extracts static base BufferGeometry without updating or mutating the source.
 * Vertex shaders are not evaluated; ShaderMaterial and instance/subclass compile hooks are rejected.
 * No camera culling, material shading, texture reads, area weighting or sampling.
 * Vertex colors are already linear in Three; material color/opacity stay in bindings.
 * Primitive order is visible DFS, then group order; single-material meshes ignore groups.
 * Mirrored transforms swap corners 1/2 with all attributes to retain local front-face.
 * Working-byte admission reserves 8 KiB/triangle for JS records and two JSON copies,
 * plus bounded traversal/binding scratch. It excludes caller-owned model/GPU allocations.
 */
export function extractThreeSurface(
	root: ThreeSurfaceObject,
	limits: ThreeSurfaceLimits = {},
) {
	if (!root?.isObject3D) fail("invalid Object3D root");
	const budget = { ...CAPS, ...limits };
	for (const key of Object.keys(budget) as (keyof typeof CAPS)[]) {
		if (
			!(key in CAPS) ||
			!integer(budget[key]) ||
			budget[key] < 1 ||
			budget[key] > CAPS[key]
		)
			fail(`invalid limit ${key}`);
	}
	const seen = new Set<ThreeSurfaceObject>(),
		buffers = new Set<ArrayBufferLike>();
	const materials: ThreeSurfaceMaterial[] = [],
		materialIndices = new Map<ThreeSurfaceMaterial, number>();
	const plans: SurfacePlan[] = [];
	let objects = 0,
		geometryBytes = 0,
		triangleCount = 0,
		groupCount = 0;
	const working = () =>
		65536 +
		objects * 1024 +
		plans.length * 1024 +
		materials.length * 512 +
		triangleCount * 8192;
	const admit = () => {
		if (triangleCount > budget.maxTriangles) fail("triangle limit exceeded");
		if (working() > budget.maxWorkingBytes)
			fail("JS working-byte limit exceeded");
	};
	const objectCheck = (object: ThreeSurfaceObject) => {
		if (!object?.isObject3D || seen.has(object))
			fail("invalid, cyclic or shared Object3D tree");
		if (
			++objects > budget.maxObjects ||
			object.children.length > budget.maxObjects
		)
			fail("object limit exceeded");
		seen.add(object);
		admit();
	};
	const attribute = (
		a: Attribute | undefined,
		sizes: number[],
		count?: number,
	): Attribute => {
		if (
			!a ||
			(!a.isBufferAttribute && !a.isInterleavedBufferAttribute) ||
			a.isInstancedBufferAttribute ||
			a.data?.isInstancedInterleavedBuffer
		)
			return fail("unsupported/missing CPU buffer attribute");
		if (
			!sizes.includes(a.itemSize) ||
			!integer(a.count) ||
			(count !== undefined && a.count !== count) ||
			!ArrayBuffer.isView(a.array) ||
			!integer(a.array.length)
		)
			fail("invalid attribute shape");
		const stride = a.isInterleavedBufferAttribute ? a.data?.stride : a.itemSize;
		const offset = a.isInterleavedBufferAttribute ? a.offset : 0;
		if (
			!stride ||
			!integer(stride) ||
			offset === undefined ||
			!integer(offset) ||
			offset + a.itemSize > stride ||
			a.count * stride !== a.array.length
		)
			fail("invalid attribute storage");
		if (
			typeof SharedArrayBuffer !== "undefined" &&
			a.array.buffer instanceof SharedArrayBuffer
		)
			fail("shared mutable geometry buffers are unsupported");
		if (!buffers.has(a.array.buffer)) {
			geometryBytes += a.array.buffer.byteLength;
			if (geometryBytes > budget.maxGeometryBytes)
				fail("geometry-byte limit exceeded");
			buffers.add(a.array.buffer);
		}
		return a;
	};
	const parents: ThreeSurfaceObject[] = [];
	for (let parent = root.parent; parent; parent = parent.parent) {
		objectCheck(parent);
		parents.push(parent);
	}
	let parentWorld: Matrix | undefined;
	for (const parent of parents.reverse()) {
		if (!parent.visible)
			return {
				triangles: [],
				materials,
				primitives: [],
				estimatedWorkingBytes: working(),
			};
		parentWorld = world(parent, parentWorld);
	}
	const stack: { object: ThreeSurfaceObject; parent?: Matrix }[] = [
		{ object: root, parent: parentWorld },
	];
	while (stack.length) {
		const { object, parent } = stack.pop()!;
		objectCheck(object);
		if (!object.visible) continue;
		const matrix = world(object, parent);
		if (
			object.isSkinnedMesh ||
			object.isInstancedMesh ||
			object.isBatchedMesh ||
			object.isLine ||
			object.isPoints ||
			object.isSprite ||
			object.isLOD
		)
			fail("unsupported dynamic or non-triangle object");
		if (object.morphTargetInfluences) {
			const influences = object.morphTargetInfluences;
			if (!Array.isArray(influences) || influences.length > 256)
				fail("active/invalid morph targets are unsupported");
			for (let i = 0; i < influences.length; i++)
				if (influences[i] !== 0)
					fail("active/invalid morph targets are unsupported");
		}
		if (object.isMesh) {
			const geometry = object.geometry;
			if (!geometry?.isBufferGeometry || geometry.isInstancedBufferGeometry)
				fail("unsupported mesh geometry");
			const g = geometry!;
			const position = attribute(g.attributes.position, [3]);
			for (const [name, sizes] of [
				["normal", [3]],
				["uv", [2]],
				["color", [3, 4]],
			] as const)
				if (g.attributes[name])
					attribute(g.attributes[name], [...sizes], position.count);
			if (g.index) {
				attribute(g.index, [1]);
				if (
					g.index.normalized ||
					g.index.isInterleavedBufferAttribute ||
					!(
						g.index.array instanceof Uint8Array ||
						g.index.array instanceof Uint16Array ||
						g.index.array instanceof Uint32Array
					)
				)
					fail("unsupported triangle index buffer");
			}
			const determinant = matrix.determinant();
			if (!Number.isFinite(determinant) || determinant === 0)
				fail("singular/nonfinite normal transform");
			const normal = object.normalMatrix.clone().getNormalMatrix(matrix);
			if (!finite(normal.elements))
				fail("nonfinite inverse-transpose normal transform");
			const total = g.index?.count ?? position.count;
			const [drawStart, drawEnd] = range(
				g.drawRange.start,
				g.drawRange.count,
				total,
			);
			groupCount += g.groups.length;
			if (groupCount > budget.maxObjects) fail("group limit exceeded");
			const array = Array.isArray(object.material);
			const list = Array.isArray(object.material)
				? object.material
				: [object.material];
			if (list.length > budget.maxObjects) fail("material limit exceeded");
			const groups = array
				? g.groups
				: [{ start: 0, count: total, materialIndex: 0 }];
			for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
				const group = groups[groupIndex],
					slot = group.materialIndex ?? 0;
				if (!integer(slot) || !list[slot]?.isMaterial)
					fail("missing/invalid group material");
				const material = list[slot]!;
				const [groupStart, groupEnd] = range(group.start, group.count, total);
				const start = Math.max(drawStart, groupStart),
					end = Math.min(drawEnd, groupEnd);
				if (!material.visible || end <= start) continue;
				staticMaterial(material);
				if (material.wireframe || material.displacementMap)
					fail("wireframe/displaced material is unsupported");
				if ((end - start) % 3)
					fail("draw/group range must contain complete triangles");
				let materialIndex = materialIndices.get(material);
				if (materialIndex === undefined) {
					materialIndex = materials.length;
					materials.push(material);
					materialIndices.set(material, materialIndex);
				}
				const primitive = {
					mesh: object,
					groupIndex: array ? groupIndex : null,
					materialSlot: slot,
					materialIndex,
					triangleStart: triangleCount,
					triangleCount: (end - start) / 3,
				};
				triangleCount += primitive.triangleCount;
				plans.push({
					mesh: object,
					matrix,
					normal,
					geometry: g,
					start,
					end,
					mirrored: determinant < 0,
					primitive,
				});
				admit();
			}
		} else if (object.geometry)
			fail("geometry attached to unsupported non-mesh object");
		if (stack.length + object.children.length + objects > budget.maxObjects)
			fail("object limit exceeded");
		for (let i = object.children.length - 1; i >= 0; i--) {
			if (object.children[i].parent !== object)
				fail("inconsistent Object3D parent link");
			stack.push({ object: object.children[i], parent: matrix });
		}
	}
	const triangles = extractSurfaceVertices(plans);
	return {
		triangles,
		materials,
		primitives: plans.map((plan) => plan.primitive),
		estimatedWorkingBytes: working(),
	};
}

import type {
	SurfacePlan,
	ThreeSurfaceTriangle,
	V2,
	V3,
	V4,
} from "./three-surface-types";
const fail = (reason: string): never => {
	throw Error(`Three surface: ${reason}`);
};
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const finite = (values: readonly number[]) => values.every(Number.isFinite);

export function extractSurfaceVertices(
	plans: readonly SurfacePlan[],
): ThreeSurfaceTriangle[] {
	const triangles: ThreeSurfaceTriangle[] = [];
	for (
		let primitiveIndex = 0;
		primitiveIndex < plans.length;
		primitiveIndex++
	) {
		const {
			mesh,
			matrix,
			normal,
			geometry: g,
			start,
			end,
			mirrored,
			primitive,
		} = plans[primitiveIndex];
		const vector = mesh.position.clone();
		for (let offset = start; offset < end; offset += 3) {
			const triangle: ThreeSurfaceTriangle = {
				position: [] as unknown as [V3, V3, V3],
				primitiveIndex,
				materialIndex: primitive.materialIndex,
			};
			for (let corner = 0; corner < 3; corner++) {
				const sourceCorner = mirrored && corner > 0 ? 3 - corner : corner;
				const index = g.index
					? g.index.getX(offset + sourceCorner)
					: offset + sourceCorner;
				const a = g.attributes.position!;
				if (!integer(index) || index >= a.count)
					fail("triangle index is out of range");
				vector
					.set(a.getX(index), a.getY(index), a.getZ(index))
					.applyMatrix4(matrix);
				const position: V3 = [vector.x, vector.y, vector.z];
				if (!finite(position)) fail("nonfinite world position");
				triangle.position.push(position);
				const n = g.attributes.normal,
					uv = g.attributes.uv,
					color = g.attributes.color;
				if (n) {
					vector
						.set(n.getX(index), n.getY(index), n.getZ(index))
						.applyNormalMatrix(normal);
					const value: V3 = [vector.x, vector.y, vector.z];
					if (
						!finite(value) ||
						!Number.isFinite(vector.length()) ||
						vector.length() === 0
					)
						fail("invalid transformed vertex normal");
					(triangle.normal ??= [] as unknown as [V3, V3, V3]).push(value);
				}
				if (uv) {
					const value: V2 = [uv.getX(index), uv.getY(index)];
					if (!finite(value)) fail("nonfinite UV");
					(triangle.uv ??= [] as unknown as [V2, V2, V2]).push(value);
				}
				if (color) {
					const value: V4 = [
						color.getX(index),
						color.getY(index),
						color.getZ(index),
						color.itemSize === 4 ? color.getW(index) : 1,
					];
					if (
						!finite(value) ||
						value.some((component) => component < 0 || component > 1)
					)
						fail("vertex color must be linear RGBA in [0,1]");
					(triangle.color ??= [] as unknown as [V4, V4, V4]).push(value);
				}
			}
			triangles.push(triangle);
		}
	}
	return triangles;
}

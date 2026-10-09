import {
	clothPhysics,
	type ClothOracleInput,
	type ClothOracleState,
	type ClothPoint,
	type ClothVector,
} from "./cloth-oracle-physics";

export interface ClothOracleFace {
	index: number;
	vertices: { position: ClothPoint; uv: ClothPoint; w: number }[];
	normal: ClothVector;
	brightness: number;
	opacity: number;
	depth: number;
}
export interface ClothOracleMesh {
	physics: ClothOracleState;
	image: string;
	rect: ClothOracleState["rect"];
	fit: ClothOracleInput["settings"]["fit"];
	opacity: number;
	fullImage: boolean;
	faces: ClothOracleFace[];
}
interface Corner {
	point: ClothVector;
	uv: ClothPoint;
	w: number;
}
type Barycentric = { weights: ClothVector; w: number };
const near = 0.05;

function normalOf(corners: Corner[]): ClothVector {
	const u = corners[1].point.map(
		(value, axis) => value - corners[0].point[axis],
	);
	const v = corners[2].point.map(
		(value, axis) => value - corners[0].point[axis],
	);
	const normal: ClothVector = [
		u[1] * v[2] - u[2] * v[1],
		u[2] * v[0] - u[0] * v[2],
		u[0] * v[1] - u[1] * v[0],
	];
	const magnitude = Math.sqrt(
		normal.reduce((sum, value) => sum + value * value, 0),
	);
	return magnitude > 2 ** -1022
		? (normal.map((value) => value / magnitude) as ClothVector)
		: [0, 0, 1];
}

// Intersect the near half-space with a triangle in barycentric coordinates.
// Gather its feasible corners and edge intersections, then order that convex set.
function visiblePolygon(triangle: Corner[]): Corner[] {
	const candidates: Barycentric[] = [];
	triangle.forEach((corner, index) => {
		if (corner.w >= near) {
			const weights: ClothVector = [0, 0, 0];
			weights[index] = 1;
			candidates.push({ weights, w: corner.w });
		}
	});
	for (const [a, b] of [
		[0, 1],
		[0, 2],
		[1, 2],
	]) {
		const wa = triangle[a].w,
			wb = triangle[b].w;
		if ((wa < near && wb > near) || (wa > near && wb < near)) {
			const weightB = (near - wa) / (wb - wa);
			const weights: ClothVector = [0, 0, 0];
			weights[a] = 1 - weightB;
			weights[b] = weightB;
			candidates.push({ weights, w: near });
		}
	}
	if (candidates.length < 3) return [];
	const center = candidates.reduce<ClothPoint>(
		(sum, { weights }) => [
			sum[0] + weights[1] / candidates.length,
			sum[1] + weights[2] / candidates.length,
		],
		[0, 0],
	);
	candidates.sort(
		(a, b) =>
			Math.atan2(a.weights[2] - center[1], a.weights[1] - center[0]) -
			Math.atan2(b.weights[2] - center[1], b.weights[1] - center[0]),
	);
	return candidates.map(({ weights, w }) => ({
		w,
		point: [0, 1, 2].map((axis) =>
			weights.reduce(
				(sum, weight, index) => sum + weight * triangle[index].point[axis],
				0,
			),
		) as ClothVector,
		uv: [0, 1].map((axis) =>
			weights.reduce(
				(sum, weight, index) => sum + weight * triangle[index].uv[axis],
				0,
			),
		) as ClothPoint,
	}));
}

/** Mesh positions and UVs are derived only from independently simulated particles. */
export function clothGeometry(input: ClothOracleInput): ClothOracleMesh {
	const physics = clothPhysics(input),
		s = input.settings;
	const output: ClothOracleMesh = {
		physics,
		image: s.image,
		rect: physics.rect,
		fit: s.fit,
		opacity: s.opacity,
		fullImage: physics.fullImage,
		faces: [],
	};
	if (physics.fullImage || s.opacity === 0) return output;
	const [left, top, width, height] = physics.rect;
	const camera = 8 * Math.max(...physics.normalizedSize);
	const vertices: Corner[] = physics.particles.map(({ position, uv }) => ({
		point: position,
		uv: [
			(left + uv[0] * width) / input.width,
			(top + uv[1] * height) / input.height,
		],
		w: 1 - (s.perspective * position[2]) / camera,
	}));
	const stride = s.columns + 1;
	const triangleIds = Array.from({ length: s.columns * s.rows }, (_, cell) => {
		const origin = Math.floor(cell / s.columns) * stride + (cell % s.columns);
		return [
			[origin, origin + 1, origin + stride],
			[origin + 1, origin + stride + 1, origin + stride],
		];
	}).flat();
	triangleIds.forEach((ids, index) => {
		const triangle = ids.map((id) => vertices[id]),
			normal = normalOf(triangle);
		const polygon = visiblePolygon(triangle);
		if (polygon.length < 3) return;
		output.faces.push({
			index,
			normal,
			brightness: 1 - s.shading * (1 - Math.min(1, Math.abs(normal[2]))),
			opacity: s.opacity,
			depth: polygon.reduce(
				(sum, corner) => sum + corner.point[2] / polygon.length,
				0,
			),
			vertices: polygon.map(({ point, uv, w }) => ({
				uv,
				w,
				position: [
					left + width / 2 + (point[0] * physics.shortSide) / w,
					top + height / 2 + (point[1] * physics.shortSide) / w,
				],
			})),
		});
	});
	output.faces.sort((a, b) => a.depth - b.depth || a.index - b.index);
	return output;
}

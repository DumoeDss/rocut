import type { MvShatter } from "../../packages/editor-contracts/src/mv-shatter";
import { assert } from "./mesh-scenes-support.mjs";

export type Point = [number, number];
type Vector = [number, number, number];
type Rect = [number, number, number, number];
type Constraint = [number, number, number];
export interface ShatterCell {
	index: number;
	source: Point[];
	center: Point;
	worldCenter: Vector;
	basisX: Vector;
	basisY: Vector;
	normal: Vector;
	outline: Point[];
	shadowOutline: Point[];
	brightness: number;
	colorOffset: Point;
}
export interface ShatterGeometry {
	rect: Rect;
	sites: Point[];
	columns: number;
	rows: number;
	rectangles: boolean;
	optical: Point;
	projection: number;
	cells: ShatterCell[];
}
const random = (seed: number, key: number) => {
	let value = (seed ^ Math.imul(key, 374761393)) >>> 0;
	value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
	return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Enumerate feasible intersections of constraint pairs, not a polygon clipping pass.
function intersections(constraints: Constraint[]): Point[] {
	const points: Point[] = [];
	for (let i = 0; i < constraints.length; i++)
		for (let j = i + 1; j < constraints.length; j++) {
			const [a, b, c] = constraints[i],
				[d, e, f] = constraints[j];
			const determinant = a * e - b * d;
			if (determinant === 0) continue;
			const point: Point = [
				(c * e - b * f) / determinant,
				(a * f - c * d) / determinant,
			];
			if (!point.every(Number.isFinite)) continue;
			const gaps = constraints.map(
				([x, y, limit]) => x * point[0] + y * point[1] - limit,
			);
			if (gaps.some((gap, k) => k !== i && k !== j && gap > 1e-12)) continue;
			assert(
				gaps.every((gap, k) => k === i || k === j || Math.abs(gap) > 1e-12),
				"Shatter oracle ambiguous near-degenerate constraints",
			);
			if (
				points.some(
					(other) =>
						Object.is(other[0], point[0]) && Object.is(other[1], point[1]),
				)
			)
				continue;
			assert(
				points.every(
					(other) =>
						Math.hypot(other[0] - point[0], other[1] - point[1]) >= 1e-11,
				),
				"Shatter oracle ambiguous near-degenerate constraints",
			);
			points.push(point);
		}
	assert(points.length >= 3, "Shatter oracle produced an empty Voronoi cell");
	const center = points.reduce<Point>(
		(sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length],
		[0, 0],
	);
	return points.sort(
		(a, b) =>
			Math.atan2(a[1] - center[1], a[0] - center[0]) -
			Math.atan2(b[1] - center[1], b[0] - center[0]),
	);
}

function rotation([x, y, z]: Vector): [Vector, Vector, Vector] {
	const sx = Math.sin(x),
		cx = Math.cos(x),
		sy = Math.sin(y),
		cy = Math.cos(y),
		sz = Math.sin(z),
		cz = Math.cos(z);
	// Columns of Rz * Ry * Rx; inverse rotation is the transpose.
	return [
		[cz * cy, sz * cy, -sy],
		[cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx],
		[cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx],
	];
}

export function shatterGeometry({
	settings,
	progress,
	width,
	height,
	seed = 19,
	rectangles = false,
}: {
	settings: MvShatter;
	progress: number;
	width: number;
	height: number;
	seed?: number;
	rectangles?: boolean;
}): ShatterGeometry {
	assert(
		settings.fragments >= 4 &&
			settings.fragments <= 64 &&
			Number.isInteger(settings.fragments),
		"Independent Shatter pixel oracle supports 4..64 cells; larger budget cases belong in native tests",
	);
	const rect: Rect = [
		settings.rect[0] * width,
		settings.rect[1] * height,
		settings.rect[2] * width,
		settings.rect[3] * height,
	];
	const [left, top, rw, rh] = rect,
		long = Math.max(rw, rh),
		short = Math.min(rw, rh),
		count = settings.fragments;
	const columns = Math.max(
			1,
			Math.min(count, Math.round(Math.sqrt((count * rw) / rh))),
		),
		rows = Math.ceil(count / columns);
	const sites: Point[] = Array.from({ length: count }, (_, i) => {
		const row = Math.floor(i / columns),
			rowCount = Math.min(columns, count - row * columns);
		return [
			((((i % columns) + 0.15 + 0.7 * random(seed, i * 2)) / rowCount) * rw) /
				long,
			(((row + 0.15 + 0.7 * random(seed, i * 2 + 1)) / rows) * rh) / long,
		];
	});
	const optical: Point = [left + rw / 2, top + rh / 2],
		projection = settings.perspective / (4 * long);
	const p = Math.max(0, Math.min(1, progress));
	const cells = sites.map((site, index): ShatterCell => {
		let source: Point[];
		if (rectangles) {
			const row = Math.floor(index / columns),
				rowCount = Math.min(columns, count - row * columns),
				col = index % columns;
			source = [
				[col / rowCount, row / rows],
				[(col + 1) / rowCount, row / rows],
				[(col + 1) / rowCount, (row + 1) / rows],
				[col / rowCount, (row + 1) / rows],
			];
			source = source.map(([x, y]) => [left + x * rw, top + y * rh]);
		} else {
			const constraints: Constraint[] = [
				[-1, 0, 0],
				[1, 0, rw / long],
				[0, -1, 0],
				[0, 1, rh / long],
			];
			for (let j = 0; j < sites.length; j++)
				if (j !== index) {
					const other = sites[j],
						a = other[0] - site[0],
						b = other[1] - site[1];
					constraints.push([
						a,
						b,
						(other[0] ** 2 + other[1] ** 2 - site[0] ** 2 - site[1] ** 2) / 2,
					]);
				}
			source = intersections(constraints).map(([x, y]) => [
				left + x * long,
				top + y * long,
			]);
		}
		const center = source.reduce<Point>(
			(sum, v) => [
				sum[0] + v[0] / source.length,
				sum[1] + v[1] / source.length,
			],
			[0, 0],
		);
		const key = 0x13570000 + index * 8,
			dx = center[0] - left - settings.center[0] * rw,
			dy = center[1] - top - settings.center[1] * rh;
		const direction =
			dx === 0 && dy === 0
				? 2 * Math.PI * random(seed, key)
				: Math.atan2(dy, dx) + 0.7 * random(seed, key) - 0.35;
		const distance =
			settings.spread * short * p * (0.5 + 0.5 * random(seed, key + 1));
		const worldCenter: Vector = [
			center[0] + Math.cos(direction) * distance,
			center[1] +
				Math.sin(direction) * distance +
				settings.gravity * short * p * p,
			settings.depth * short * p * (0.25 + 0.75 * random(seed, key + 2)),
		];
		const angles: Vector = [3, 4, 5].map(
			(offset) => settings.spin * p * (2 * random(seed, key + offset) - 1),
		) as Vector;
		const [basisX, basisY, normal] = rotation(angles);
		const world = source.map(
			(point) =>
				worldCenter.map(
					(v, axis) =>
						v +
						basisX[axis] * (point[0] - center[0]) +
						basisY[axis] * (point[1] - center[1]),
				) as Vector,
		);
		return {
			index,
			source,
			center,
			worldCenter,
			basisX,
			basisY,
			normal,
			outline: world.map((v) => [
				optical[0] + (v[0] - optical[0]) / (1 - projection * v[2]),
				optical[1] + (v[1] - optical[1]) / (1 - projection * v[2]),
			]),
			shadowOutline: world.map((v) => [v[0] + 0.35 * v[2], v[1] + 0.45 * v[2]]),
			brightness: 1 - settings.shading * (1 - Math.abs(normal[2])),
			colorOffset: [
				(normal[0] * settings.refraction * short * p) / width,
				(normal[1] * settings.refraction * short * p) / height,
			],
		};
	});
	return { rect, sites, columns, rows, rectangles, optical, projection, cells };
}

function owns(
	geometry: ShatterGeometry,
	index: number,
	source: Point,
): boolean {
	const [left, top, rw, rh] = geometry.rect,
		[x, y] = [source[0] - left, source[1] - top];
	if (x < 0 || y < 0 || x >= rw || y >= rh) return false;
	if (geometry.rectangles) {
		const row = Math.floor((y / rh) * geometry.rows),
			rowCount = Math.min(
				geometry.columns,
				geometry.sites.length - row * geometry.columns,
			);
		return row * geometry.columns + Math.floor((x / rw) * rowCount) === index;
	}
	const long = Math.max(rw, rh),
		point: Point = [x / long, y / long];
	let winner = 0,
		distance = Infinity;
	for (let i = 0; i < geometry.sites.length; i++) {
		const candidate =
			(point[0] - geometry.sites[i][0]) ** 2 +
			(point[1] - geometry.sites[i][1]) ** 2;
		if (candidate < distance) {
			distance = candidate;
			winner = i;
		}
	}
	return winner === index;
}

export function shatterSourceAt(
	geometry: ShatterGeometry,
	cell: ShatterCell,
	point: Point,
	shadow = false,
): Point | null {
	let local: Point;
	const [cx, cy, cz] = cell.worldCenter;
	if (shadow) {
		const a = cell.basisX[0] + 0.35 * cell.basisX[2],
			b = cell.basisY[0] + 0.35 * cell.basisY[2];
		const c = cell.basisX[1] + 0.45 * cell.basisX[2],
			d = cell.basisY[1] + 0.45 * cell.basisY[2],
			determinant = a * d - b * c;
		if (determinant === 0) return null;
		const x = point[0] - cx - 0.35 * cz,
			y = point[1] - cy - 0.45 * cz;
		local = [(x * d - b * y) / determinant, (a * y - c * x) / determinant];
	} else {
		const [nx, ny, nz] = cell.normal,
			qx = point[0] - geometry.optical[0],
			qy = point[1] - geometry.optical[1],
			k = geometry.projection;
		const denominator = nz - k * (nx * qx + ny * qy);
		if (denominator === 0) return null;
		const z =
			(nx * (cx - point[0]) + ny * (cy - point[1]) + nz * cz) / denominator;
		if (!(1 - k * z > 0)) return null;
		const displacement: Vector = [
			point[0] - k * qx * z - cx,
			point[1] - k * qy * z - cy,
			z - cz,
		];
		local = [dot(displacement, cell.basisX), dot(displacement, cell.basisY)];
	}
	const source: Point = [cell.center[0] + local[0], cell.center[1] + local[1]];
	return source.every(Number.isFinite) && owns(geometry, cell.index, source)
		? source
		: null;
}

/** Deliberately incorrect UV interpolation on the same independent projected geometry. */
export function affineShatterSource(
	cell: ShatterCell,
	point: Point,
): Point | null {
	const a = cell.outline[0];
	for (let i = 1; i + 1 < cell.outline.length; i++) {
		const b = cell.outline[i],
			c = cell.outline[i + 1],
			dx = point[0] - a[0],
			dy = point[1] - a[1];
		const bx = b[0] - a[0],
			by = b[1] - a[1],
			cx = c[0] - a[0],
			cy = c[1] - a[1],
			determinant = bx * cy - by * cx;
		if (determinant === 0) continue;
		const v = (dx * cy - dy * cx) / determinant,
			w = (bx * dy - by * dx) / determinant;
		if (v >= -1e-10 && w >= -1e-10 && v + w <= 1 + 1e-10)
			return [0, 1].map(
				(axis) =>
					(1 - v - w) * cell.source[0][axis] +
					v * cell.source[i][axis] +
					w * cell.source[i + 1][axis],
			) as Point;
	}
	return null;
}

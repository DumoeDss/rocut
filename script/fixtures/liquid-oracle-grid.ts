import type { LiquidOracleGrid } from "./liquid-oracle";

export const liquidDt = 1 / 120;
export type LiquidLocation = "u" | "v" | "cell";
export type LiquidPoint = [number, number];
export interface LiquidVelocity {
	u: LiquidField;
	v: LiquidField;
}

export class LiquidField {
	private readonly strips: Float64Array[];
	constructor(
		readonly xCount: number,
		readonly yCount: number,
		value: (x: number, y: number) => number = () => 0,
	) {
		this.strips = Array.from({ length: xCount }, (_, x) =>
			Float64Array.from({ length: yCount }, (_, y) => value(x, y)),
		);
	}
	get(x: number, y: number): number {
		return this.strips[x][y];
	}
	set(x: number, y: number, value: number): void {
		this.strips[x][y] = value;
	}
	clamped(x: number, y: number): number {
		return this.get(
			Math.max(0, Math.min(this.xCount - 1, x)),
			Math.max(0, Math.min(this.yCount - 1, y)),
		);
	}
	map(transform: (value: number, x: number, y: number) => number): LiquidField {
		return new LiquidField(this.xCount, this.yCount, (x, y) =>
			transform(this.get(x, y), x, y),
		);
	}
	visit(visitor: (value: number, x: number, y: number) => void): void {
		for (let x = 0; x < this.xCount; x += 1)
			for (let y = 0; y < this.yCount; y += 1) visitor(this.get(x, y), x, y);
	}
	mean(): number {
		let total = 0;
		this.visit((value) => {
			total += value;
		});
		return total / (this.xCount * this.yCount);
	}
	rowMajor(): Float64Array {
		const output = new Float64Array(this.xCount * this.yCount);
		this.visit((value, x, y) => {
			output[y * this.xCount + x] = value;
		});
		return output;
	}
}

const offsets: Record<LiquidLocation, LiquidPoint> = {
	u: [0, 0.5],
	v: [0.5, 0],
	cell: [0.5, 0.5],
};
export function liquidPosition(
	location: LiquidLocation,
	x: number,
	y: number,
	grid: LiquidOracleGrid,
): LiquidPoint {
	return [
		(x + offsets[location][0]) * grid.dx,
		(y + offsets[location][1]) * grid.dy,
	];
}
export function fixedFace(
	location: LiquidLocation,
	x: number,
	y: number,
	grid: LiquidOracleGrid,
): boolean {
	return (
		(location === "u" && (x === 0 || x === grid.columns)) ||
		(location === "v" && (y === 0 || y === grid.rows))
	);
}

export function sampleLiquid(
	field: LiquidField,
	location: LiquidLocation,
	point: LiquidPoint,
	grid: LiquidOracleGrid,
): number {
	const coordinate = [
		point[0] / grid.dx - offsets[location][0],
		point[1] / grid.dy - offsets[location][1],
	].map((value, axis) =>
		Math.max(0, Math.min([field.xCount - 1, field.yCount - 1][axis], value)),
	);
	const low = coordinate.map(Math.floor),
		fraction = coordinate.map((value, axis) => value - low[axis]);
	let sum = 0;
	for (const [ox, oy] of [
		[0, 0],
		[1, 0],
		[0, 1],
		[1, 1],
	]) {
		const weight =
			(ox ? fraction[0] : 1 - fraction[0]) *
			(oy ? fraction[1] : 1 - fraction[1]);
		sum += weight * field.clamped(low[0] + ox, low[1] + oy);
	}
	return sum;
}

export function advectLiquid(
	field: LiquidField,
	location: LiquidLocation,
	flow: LiquidVelocity,
	grid: LiquidOracleGrid,
): LiquidField {
	const clamp = (point: LiquidPoint): LiquidPoint => [
		Math.max(0, Math.min(grid.Lx, point[0])),
		Math.max(0, Math.min(grid.Ly, point[1])),
	];
	const velocity = (point: LiquidPoint): LiquidPoint => [
		sampleLiquid(flow.u, "u", point, grid),
		sampleLiquid(flow.v, "v", point, grid),
	];
	return field.map((_, x, y) => {
		if (fixedFace(location, x, y, grid)) return 0;
		const origin = liquidPosition(location, x, y, grid),
			first = velocity(origin);
		const midpoint = clamp([
			origin[0] - (liquidDt * first[0]) / 2,
			origin[1] - (liquidDt * first[1]) / 2,
		]);
		const middle = velocity(midpoint);
		return sampleLiquid(
			field,
			location,
			clamp([
				origin[0] - liquidDt * middle[0],
				origin[1] - liquidDt * middle[1],
			]),
			grid,
		);
	});
}

export function liquidDivergence(
	flow: LiquidVelocity,
	grid: LiquidOracleGrid,
): LiquidField {
	return new LiquidField(
		grid.columns,
		grid.rows,
		(x, y) =>
			(flow.u.get(x + 1, y) - flow.u.get(x, y)) / grid.dx +
			(flow.v.get(x, y + 1) - flow.v.get(x, y)) / grid.dy,
	);
}

import type { LiquidOracleGrid } from "./liquid-oracle";
import {
	fixedFace,
	liquidDivergence,
	liquidDt,
	LiquidField,
	type LiquidLocation,
	type LiquidVelocity,
} from "./liquid-oracle-grid";

interface Adjacent {
	x: number;
	y: number;
	weight: number;
}
interface Equation {
	x: number;
	y: number;
	diagonal: number;
	neighbors: Adjacent[];
}

function equations(
	xCount: number,
	yCount: number,
	grid: LiquidOracleGrid,
): Equation[] {
	const graph: Equation[] = [];
	for (let x = 0; x < xCount; x += 1) {
		for (let y = 0; y < yCount; y += 1) {
			const neighbors: Adjacent[] = [
				[-1, 0, 1 / grid.dx ** 2],
				[1, 0, 1 / grid.dx ** 2],
				[0, -1, 1 / grid.dy ** 2],
				[0, 1, 1 / grid.dy ** 2],
			]
				.map(([ox, oy, weight]) => ({ x: x + ox, y: y + oy, weight }))
				.filter(
					(point) =>
						point.x >= 0 &&
						point.x < xCount &&
						point.y >= 0 &&
						point.y < yCount,
				);
			graph.push({
				x,
				y,
				neighbors,
				diagonal: neighbors.reduce((sum, edge) => sum + edge.weight, 0),
			});
		}
	}
	return graph;
}

/** All matrices are request-local. Missing grid neighbors supply a Neumann boundary. */
export function liquidOperators(grid: LiquidOracleGrid) {
	const graphs = {
		u: equations(grid.columns + 1, grid.rows, grid),
		v: equations(grid.columns, grid.rows + 1, grid),
		cell: equations(grid.columns, grid.rows, grid),
	};
	const neighborSum = (equation: Equation, values: LiquidField) =>
		equation.neighbors.reduce(
			(sum, neighbor) =>
				sum + neighbor.weight * values.get(neighbor.x, neighbor.y),
			0,
		);
	return {
		diffuse(
			rhs: LiquidField,
			location: LiquidLocation,
			viscosity: number,
			iterations: number,
		): LiquidField {
			if (viscosity === 0) return rhs;
			const strength = viscosity * liquidDt;
			let current = rhs;
			for (let iteration = 0; iteration < iterations; iteration += 1) {
				const next = new LiquidField(rhs.xCount, rhs.yCount);
				for (const equation of graphs[location]) {
					if (fixedFace(location, equation.x, equation.y, grid)) continue;
					next.set(
						equation.x,
						equation.y,
						(rhs.get(equation.x, equation.y) +
							strength * neighborSum(equation, current)) /
							(1 + strength * equation.diagonal),
					);
				}
				current = next;
			}
			return current;
		},
		project(
			flow: LiquidVelocity,
			iterations: number,
		): LiquidVelocity & { pressure: LiquidField } {
			const rhs = liquidDivergence(flow, grid).map((value) => value / liquidDt);
			const mean = rhs.mean();
			let pressure = new LiquidField(grid.columns, grid.rows);
			for (let iteration = 0; iteration < iterations; iteration += 1) {
				const next = new LiquidField(grid.columns, grid.rows);
				for (const equation of graphs.cell) {
					const candidate =
						(neighborSum(equation, pressure) -
							(rhs.get(equation.x, equation.y) - mean)) /
						equation.diagonal;
					next.set(
						equation.x,
						equation.y,
						pressure.get(equation.x, equation.y) / 3 + candidate * (2 / 3),
					);
				}
				pressure = next;
			}
			const offset = pressure.mean();
			pressure = pressure.map((value) => value - offset);
			return {
				pressure,
				u: flow.u.map((value, x, y) =>
					fixedFace("u", x, y, grid)
						? 0
						: value -
							(liquidDt * (pressure.get(x, y) - pressure.get(x - 1, y))) /
								grid.dx,
				),
				v: flow.v.map((value, x, y) =>
					fixedFace("v", x, y, grid)
						? 0
						: value -
							(liquidDt * (pressure.get(x, y) - pressure.get(x, y - 1))) /
								grid.dy,
				),
			};
		},
	};
}

export function confineLiquid(
	flow: LiquidVelocity,
	grid: LiquidOracleGrid,
	strength: number,
): LiquidVelocity {
	if (strength === 0) return flow;
	const centerU = new LiquidField(
		grid.columns,
		grid.rows,
		(x, y) => (flow.u.get(x, y) + flow.u.get(x + 1, y)) / 2,
	);
	const centerV = new LiquidField(
		grid.columns,
		grid.rows,
		(x, y) => (flow.v.get(x, y) + flow.v.get(x, y + 1)) / 2,
	);
	const derivative = (
		field: LiquidField,
		x: number,
		y: number,
		axis: number,
	) =>
		axis === 0
			? (field.clamped(x + 1, y) - field.clamped(x - 1, y)) / (2 * grid.dx)
			: (field.clamped(x, y + 1) - field.clamped(x, y - 1)) / (2 * grid.dy);
	const curl = new LiquidField(
		grid.columns,
		grid.rows,
		(x, y) => derivative(centerV, x, y, 0) - derivative(centerU, x, y, 1),
	);
	const magnitude = curl.map(Math.abs);
	const forceX = new LiquidField(grid.columns, grid.rows),
		forceY = new LiquidField(grid.columns, grid.rows);
	curl.visit((rotation, x, y) => {
		const gx = derivative(magnitude, x, y, 0),
			gy = derivative(magnitude, x, y, 1);
		const length = Math.hypot(gx, gy);
		if (length === 0) return;
		const scale = strength * Math.min(grid.dx, grid.dy) * rotation;
		forceX.set(x, y, (scale * gy) / length);
		forceY.set(x, y, (-scale * gx) / length);
	});
	return {
		u: flow.u.map((value, x, y) =>
			fixedFace("u", x, y, grid)
				? 0
				: value + (liquidDt * (forceX.get(x - 1, y) + forceX.get(x, y))) / 2,
		),
		v: flow.v.map((value, x, y) =>
			fixedFace("v", x, y, grid)
				? 0
				: value + (liquidDt * (forceY.get(x, y - 1) + forceY.get(x, y))) / 2,
		),
	};
}

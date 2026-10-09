import { assert, over, sampleRgba } from "./mesh-scenes-support.mjs";

const orient = (a, b, p) =>
	(b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const topLeft = (a, b) => b[1] < a[1] || (b[1] === a[1] && b[0] > a[0]);

function triangleAt(vertices, point) {
	for (let index = 1; index + 1 < vertices.length; index++) {
		const triangle = [vertices[0], vertices[index], vertices[index + 1]];
		let area = orient(...triangle.map((vertex) => vertex.position));
		if (Math.abs(area) < 1e-12) continue;
		if (area < 0) {
			[triangle[1], triangle[2]] = [triangle[2], triangle[1]];
			area = -area;
		}
		const [a, b, c] = triangle.map((vertex) => vertex.position);
		const edges = [
			orient(b, c, point),
			orient(c, a, point),
			orient(a, b, point),
		];
		if (
			!edges.every(
				(edge, i) =>
					edge > 1e-9 ||
					(Math.abs(edge) <= 1e-9 && topLeft([b, c, a][i], [c, a, b][i])),
			)
		)
			continue;
		const weights = edges.map((edge, i) => edge / area / triangle[i].w);
		const sum = weights.reduce((total, value) => total + value, 0);
		return [0, 1].map(
			(axis) =>
				weights.reduce(
					(total, value, i) => total + value * triangle[i].uv[axis],
					0,
				) / sum,
		);
	}
	return null;
}

function segmentDistance(point, a, b) {
	const dx = b[0] - a[0],
		dy = b[1] - a[1],
		length2 = dx * dx + dy * dy;
	const t =
		length2 === 0
			? 0
			: Math.max(
					0,
					Math.min(
						1,
						((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2,
					),
				);
	return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

/** CPU test rasterizer; callers provide independent semantic geometry, never a production plan. */
export function rasterMesh({
	faces,
	texture,
	width,
	height,
	edgeMargin = 1.25,
}) {
	assert(texture.length === width * height * 4, "CPU mesh texture dimensions");
	const pixels = new Uint8ClampedArray(texture.length),
		mask = new Uint8Array(width * height).fill(1);
	let coveredSamples = 0;
	for (const face of faces) {
		const vertices = face.vertices;
		assert(
			vertices.length >= 3 &&
				vertices.every(
					(vertex) =>
						vertex.w > 0 &&
						[...vertex.position, ...vertex.uv, vertex.w].every(Number.isFinite),
				),
			"CPU mesh finite positive clip coordinates",
		);
		const minimumX = Math.max(
			0,
			Math.floor(Math.min(...vertices.map((v) => v.position[0])) - edgeMargin),
		);
		const maximumX = Math.min(
			width - 1,
			Math.ceil(Math.max(...vertices.map((v) => v.position[0])) + edgeMargin),
		);
		const minimumY = Math.max(
			0,
			Math.floor(Math.min(...vertices.map((v) => v.position[1])) - edgeMargin),
		);
		const maximumY = Math.min(
			height - 1,
			Math.ceil(Math.max(...vertices.map((v) => v.position[1])) + edgeMargin),
		);
		for (let y = minimumY; y <= maximumY; y++)
			for (let x = minimumX; x <= maximumX; x++) {
				const point = [x + 0.5, y + 0.5],
					index = y * width + x,
					offset = index * 4;
				if (
					vertices.some(
						(vertex, i) =>
							segmentDistance(
								point,
								vertex.position,
								vertices[(i + 1) % vertices.length].position,
							) <= edgeMargin,
					)
				)
					mask[index] = 0;
				const uv = triangleAt(vertices, point);
				if (!uv) continue;
				const sampled =
					uv[0] < 0 || uv[0] > 1 || uv[1] < 0 || uv[1] > 1
						? [0, 0, 0, 0]
						: sampleRgba(texture, width, height, uv[0], uv[1]);
				const top = [
					sampled[0] * face.brightness,
					sampled[1] * face.brightness,
					sampled[2] * face.brightness,
					sampled[3] * face.opacity,
				];
				pixels.set(over(top, pixels.subarray(offset, offset + 4)), offset);
				if (top[3] > 0) coveredSamples++;
			}
	}
	return { pixels, mask, coveredSamples };
}

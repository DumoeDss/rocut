// CPU native-call trace, not pixels. Original scene executes unchanged; only function exposure is injected.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = process.env.MV_HEART_ORIGINAL_ROOT;
assert.ok(root);
let recording = false;
let output = [];
function color(value) {
	if (typeof value !== "string") return value;
	if (value.startsWith("#")) {
		const n = Number.parseInt(value.slice(1), 16);
		return [
			((n >> 16) & 255) / 255,
			((n >> 8) & 255) / 255,
			(n & 255) / 255,
			1,
		];
	}
	const match = /^rgba?\(([^)]+)\)$/.exec(value);
	assert.ok(match, `Unsupported color ${value}`);
	const parts = match[1].split(",").map(Number);
	return [
		parts[0] / 255,
		parts[1] / 255,
		parts[2] / 255,
		Math.max(0, Math.min(1, parts[3] ?? 1)),
	];
}
const solid = (style) =>
	typeof style === "string" ? { kind: "solid", color: color(style) } : style;
class Context {
	constructor(main = false) {
		this.main = main;
		this.ops = [];
		this.path = [];
		this.stack = [];
		this.globalAlpha = 1;
		this.globalCompositeOperation = "source-over";
		this.fillStyle = "#000000";
		this.strokeStyle = "#000000";
		this.lineWidth = 1;
		this.lineCap = "butt";
		this.lineJoin = "miter";
	}
	save() {
		this.stack.push({
			ops: this.ops.slice(),
			alpha: this.globalAlpha,
			composite: this.globalCompositeOperation,
			fill: this.fillStyle,
			stroke: this.strokeStyle,
			width: this.lineWidth,
			cap: this.lineCap,
			join: this.lineJoin,
		});
	}
	restore() {
		const s = this.stack.pop();
		assert.ok(s);
		this.ops = s.ops;
		this.globalAlpha = s.alpha;
		this.globalCompositeOperation = s.composite;
		this.fillStyle = s.fill;
		this.strokeStyle = s.stroke;
		this.lineWidth = s.width;
		this.lineCap = s.cap;
		this.lineJoin = s.join;
	}
	translate(x, y) {
		this.ops.push({ kind: "translate", offset: [x, y] });
	}
	rotate(radians) {
		this.ops.push({ kind: "rotate", radians });
	}
	scale(x, y) {
		this.ops.push({ kind: "scale", factors: [x, y] });
	}
	setTransform(...matrix) {
		assert.deepEqual(matrix, [1, 0, 0, 1, 0, 0]);
		this.ops = [];
	}
	beginPath() {
		this.path = [];
	}
	moveTo(x, y) {
		this.path.push({ kind: "moveTo", point: [x, y] });
	}
	lineTo(x, y) {
		this.path.push({ kind: "lineTo", point: [x, y] });
	}
	quadraticCurveTo(x, y, a, b) {
		this.path.push({
			kind: "quadraticCurveTo",
			control: [x, y],
			point: [a, b],
		});
	}
	arc(x, y, r, start, end, anticlockwise = false) {
		this.path.push({
			kind: "arc",
			center: [x, y],
			radius: r,
			start,
			end,
			anticlockwise,
		});
	}
	closePath() {
		this.path.push({ kind: "close" });
	}
	createRadialGradient(x, y, r, a, b, s) {
		const gradient = {
			kind: "radial",
			from: [x, y, r],
			to: [a, b, s],
			stops: [],
		};
		Object.defineProperty(gradient, "addColorStop", {
			value: (offset, c) => gradient.stops.push({ offset, color: color(c) }),
		});
		return gradient;
	}
	createLinearGradient(x, y, a, b) {
		const gradient = { kind: "linear", from: [x, y], to: [a, b], stops: [] };
		Object.defineProperty(gradient, "addColorStop", {
			value: (offset, c) => gradient.stops.push({ offset, color: color(c) }),
		});
		return gradient;
	}
	event(value) {
		if (this.main && recording)
			output.push({
				...value,
				operations: this.ops.slice(),
				opacity: this.globalAlpha,
				composite: this.globalCompositeOperation,
			});
	}
	fillRect(...rect) {
		this.event({ kind: "rect", rect, style: solid(this.fillStyle) });
	}
	fill() {
		this.event({
			kind: "path",
			path: this.path.slice(),
			style: solid(this.fillStyle),
			paintKind: "fill",
		});
	}
	stroke() {
		this.event({
			kind: "path",
			path: this.path.slice(),
			style: solid(this.strokeStyle),
			paintKind: "stroke",
			width: this.lineWidth,
			cap: this.lineCap,
			join: this.lineJoin,
		});
	}
	drawImage(image, ...args) {
		let destination;
		if (args.length === 2) destination = [...args, image.width, image.height];
		else if (args.length === 4) destination = args;
		else {
			assert.equal(args.length, 8);
			destination = args.slice(4);
		}
		this.event({
			kind: "image",
			image:
				image.tag ??
				[...context.window.figurePoolOracle.entries()].find(
					([, c]) => c === image,
				)?.[0] ??
				"halftone",
			destinationRect: destination,
		});
	}
	clip(path) {
		if (path) this.lastClip = path;
	}
	clearRect() {}
	putImageData() {}
	getImageData() {
		return { data: new Uint8ClampedArray(1600).fill(255) };
	}
}
const context = vm.createContext({
	window: {},
	console,
	ImageData: class {
		constructor(data, width, height) {
			this.data =
				typeof data === "number"
					? new Uint8ClampedArray(data * width * 4)
					: data;
			this.width = typeof data === "number" ? data : width;
			this.height = typeof data === "number" ? width : height;
		}
	},
	Path2D: class {
		path = [];
		moveTo(x, y) {
			this.path.push({ kind: "moveTo", point: [x, y] });
		}
		lineTo(x, y) {
			this.path.push({ kind: "lineTo", point: [x, y] });
		}
		closePath() {
			this.path.push({ kind: "close" });
		}
	},
});
vm.runInContext(readFileSync(`${root}/core/util.js`, "utf8"), context);
vm.runInContext(readFileSync(`${root}/core/draw.js`, "utf8"), context);
context.window.Z.canvas = (width, height) => {
	const ctx = new Context();
	return { width, height, context2d: ctx, getContext: () => ctx };
};
context.window.Z.imgSync = () => ({
	width: 20,
	height: 20,
	tag: "heart-source",
});
const glass = readFileSync(`${root}/scenes/glass.js`, "utf8");
const end = glass.lastIndexOf("})();");
assert.ok(end > 0);
vm.runInContext(
	`${glass.slice(0, end)}window.heartBuildOracle=heartBuild;window.drawGatherOracle=drawGather;window.drawSunOracle=drawSun;window.skyBuildOracle=skyBuild;window.drawSkyShatterOracle=drawSkyShatter;window.figurePoolOracle=pool;})();`,
	context,
);
const body = context.window.heartBuildOracle("heart");
body.body.tag = "body";
body.hotBody.tag = "hotBody";
for (const s of body.shards)
	for (const variant of ["base", "glow", "char", "flame"])
		s.spr[variant].tag =
			`${s.spr.ox},${s.spr.oy},${s.spr.w},${s.spr.h}:${variant}`;
for (const [index, chip] of body.chips.entries())
	chip.img.tag = `chip:${index}`;
body.crackC.tag = "cracks";
const beats = Array.from({ length: 11 }, (_, i) => i * 0.5);
const clock = context.window.Z.makeClock(beats, 120, 0);
let assertions = 0;
export function equivalent(actual, expected, path = "trace") {
	if (typeof expected === "number") {
		assert.ok(typeof actual === "number" && Number.isFinite(actual), path);
		assert.ok(
			Math.abs(actual - expected) <= 1e-8,
			`${path}: ${actual} != ${expected}`,
		);
		assertions++;
		return;
	}
	if (Array.isArray(expected)) {
		assert.ok(Array.isArray(actual), path);
		assert.equal(actual.length, expected.length, path);
		expected.forEach((v, i) => equivalent(actual[i], v, `${path}/${i}`));
		return;
	}
	if (expected && typeof expected === "object") {
		assert.deepEqual(
			Object.keys(actual).sort(),
			Object.keys(expected).sort(),
			path,
		);
		for (const key of Object.keys(expected))
			equivalent(actual[key], expected[key], `${path}/${key}`);
		return;
	}
	assert.equal(actual, expected, path);
	assertions++;
}
let skyPieces = [];
export function registerSky(sky) {
	sky.night.tag = "sky-night";
	sky.ground.tag = "sky-ground";
	skyPieces = sky.pieces;
	for (const p of sky.pieces)
		for (const variant of ["base", "glow", "dark"])
			p.spr[variant].tag =
				`${p.spr.ox},${p.spr.oy},${p.spr.w},${p.spr.h}:${variant}`;
}
function samePath(a, b) {
	if (a.length !== b.length) return false;
	return a.every(
		(p, i) =>
			p.kind === b[i].kind &&
			(!p.point ||
				p.point.every((v, k) => Math.abs(v - b[i].point[k]) <= 1e-8)),
	);
}
export function project(plan) {
	const events = [];
	const surfaces = new Map();
	for (const c of plan.commands) {
		if (c.kind === "surface") {
			if (["sky-texture", "sky-night", "sky-ground"].includes(c.id)) {
				surfaces.set(c.id, c.id);
				continue;
			}
			let tag =
				c.id === "heart-fig-b"
					? "figB"
					: c.id === "heart-fig-light"
						? "figL"
						: c.id === "heart-fig-rim"
							? "figR"
							: c.id === "heart-body"
								? "body"
								: c.id === "heart-cracks"
									? "cracks"
									: c.id === "heart-halftone"
										? "halftone"
										: c.id === "heart-hot-body"
											? "hotBody"
											: null;
			if (c.id === "heart-piece") {
				const mask = c.commands.at(-1);
				const origin = [-mask.destinationRect[0], -mask.destinationRect[1]];
				const shadow = c.commands.find((x) => x.kind === "shadowPath");
				const multiply = c.commands.some(
					(x) => x.kind === "rect" && x.paint.composite === "multiply",
				);
				const variant = shadow
					? shadow.shadow.blurPx === 16
						? "flame"
						: "glow"
					: multiply
						? "char"
						: "base";
				tag = `${origin[0]},${origin[1]},${c.size[0]},${c.size[1]}:${variant}`;
			}
			if (c.id === "sky-piece") {
				const path = c.commands.find(
					(x) => x.kind === "path" || x.kind === "shadowPath",
				).path;
				const p = skyPieces.find(
					(p) =>
						p.spr.w === c.size[0] &&
						p.spr.h === c.size[1] &&
						samePath(path, p.spr.base.context2d.lastClip.path),
				);
				assert.ok(p, "Unmatched original sky sprite");
				const variant = c.commands.some((x) => x.kind === "shadowPath")
					? "glow"
					: c.commands.some(
								(x) => x.kind === "rect" && x.paint.composite === "multiply",
						  )
						? "dark"
						: "base";
				tag = `${p.spr.ox},${p.spr.oy},${p.spr.w},${p.spr.h}:${variant}`;
			}
			assert.ok(tag, `Unexpected surface ${c.id}`);
			surfaces.set(c.id, tag);
			continue;
		}
		if (c.kind === "releaseSurface") {
			surfaces.delete(c.surface);
			continue;
		}
		const operations = c.operations ?? [];
		if (c.kind === "image") {
			events.push({
				kind: "image",
				image: c.image,
				destinationRect: c.destinationRect,
				operations,
				opacity: c.opacity,
				composite: c.composite,
			});
			continue;
		}
		if (c.kind === "blit") {
			events.push({
				kind: "image",
				image: surfaces.get(c.surface),
				destinationRect: c.destinationRect,
				operations,
				opacity: c.opacity,
				composite: c.composite,
			});
			continue;
		}
		if (c.kind === "rect") {
			events.push({
				kind: "rect",
				rect: c.rect,
				style: c.paint.style,
				operations,
				opacity: c.paint.opacity,
				composite: c.paint.composite,
			});
			continue;
		}
		assert.equal(c.kind, "path");
		for (const p of c.paints)
			events.push({
				kind: "path",
				path: c.path,
				style: p.style,
				paintKind: p.kind,
				...(p.kind === "stroke"
					? { width: p.width, cap: p.cap, join: p.join }
					: {}),
				operations,
				opacity: p.opacity,
				composite: p.composite,
			});
	}
	return events;
}

export { context, clock, Context };
export function record(draw) {
	output = [];
	recording = true;
	try {
		draw(new Context(true));
	} finally {
		recording = false;
	}
	return output;
}
export function assertionCount() {
	return assertions;
}

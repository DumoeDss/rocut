import { readFileSync } from "node:fs";
import vm from "node:vm";

function multiply(a, b) {
	return [
		a[0] * b[0] + a[2] * b[1],
		a[1] * b[0] + a[3] * b[1],
		a[0] * b[2] + a[2] * b[3],
		a[1] * b[2] + a[3] * b[3],
		a[0] * b[4] + a[2] * b[5] + a[4],
		a[1] * b[4] + a[3] * b[5] + a[5],
	];
}
function color(css) {
	if (css.startsWith("#"))
		return [...[1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16)), 1];
	const values = css.match(/[\d.+-]+/g).map(Number);
	return [...values.slice(0, 3), Math.min(1, Math.max(0, values[3] ?? 1))];
}
export function recorder() {
	const calls = [],
		counts = new Map();
	const make = (width = 1920, height = 1080, label) => {
		if (!label) {
			const key = `${width}x${height}`,
				n = counts.get(key) ?? 0;
			counts.set(key, n + 1);
			label =
				width === 480
					? "road-glow"
					: width === 128
						? "road-refraction"
						: width === 320
							? "road-rim-tint"
							: n === 0
								? "road-runner"
								: "road-reflection";
		}
		const canvas = { width, height, label };
		let matrix = [1, 0, 0, 1, 0, 0],
			path = [],
			clips = [],
			stack = [];
		const state = {
			globalAlpha: 1,
			globalCompositeOperation: "source-over",
			filter: "none",
			fillStyle: "#000000",
			strokeStyle: "#000000",
			lineWidth: 1,
			lineCap: "butt",
			lineJoin: "miter",
			imageSmoothingEnabled: true,
			imageSmoothingQuality: "low",
		};
		const style = (value) =>
			typeof value === "string" ? { color: color(value) } : value;
		const draw = (kind, args) =>
			calls.push({
				target: canvas.label,
				kind,
				args,
				matrix: [...matrix],
				clips: structuredClone(clips),
				alpha: state.globalAlpha,
				composite: state.globalCompositeOperation,
				filter: state.filter,
				...(kind === "drawImage"
					? {
							smoothing: [
								state.imageSmoothingEnabled,
								state.imageSmoothingQuality,
							],
						}
					: {
							style: structuredClone(
								style(kind === "stroke" ? state.strokeStyle : state.fillStyle),
							),
							...(kind === "stroke"
								? { line: [state.lineWidth, state.lineCap, state.lineJoin] }
								: {}),
						}),
			});
		const ctx = {
			canvas,
			save() {
				stack.push({
					matrix: [...matrix],
					clips: structuredClone(clips),
					state: { ...state },
				});
			},
			restore() {
				const saved = stack.pop();
				if (!saved) throw Error("oracle Canvas stack underflow");
				matrix = saved.matrix;
				clips = saved.clips;
				Object.assign(state, saved.state);
			},
			setTransform(...values) {
				matrix =
					values.length === 1
						? [
								values[0].a,
								values[0].b,
								values[0].c,
								values[0].d,
								values[0].e,
								values[0].f,
							]
						: [...values];
			},
			getTransform() {
				return Object.fromEntries(
					["a", "b", "c", "d", "e", "f"].map((k, i) => [k, matrix[i]]),
				);
			},
			translate(x, y) {
				matrix = multiply(matrix, [1, 0, 0, 1, x, y]);
			},
			scale(x, y) {
				matrix = multiply(matrix, [x, 0, 0, y, 0, 0]);
			},
			rotate(r) {
				matrix = multiply(matrix, [
					Math.cos(r),
					Math.sin(r),
					-Math.sin(r),
					Math.cos(r),
					0,
					0,
				]);
			},
			beginPath() {
				path = [];
			},
			closePath() {
				path.push(["closePath", [], [...matrix]]);
			},
			clip() {
				clips.push(structuredClone(path));
			},
			fill() {
				draw("fill", structuredClone(path));
			},
			stroke() {
				draw("stroke", structuredClone(path));
			},
			fillRect(...args) {
				draw("fillRect", args);
			},
			clearRect() {},
			setLineDash() {},
			drawImage(source, ...args) {
				draw("drawImage", [source.label, ...args]);
			},
		};
		for (const key of [
			"moveTo",
			"lineTo",
			"bezierCurveTo",
			"arc",
			"ellipse",
			"rect",
		])
			ctx[key] = (...args) => path.push([key, args, [...matrix]]);
		for (const key of ["createLinearGradient", "createRadialGradient"])
			ctx[key] = (...args) => {
				const gradient = { kind: key, args, matrix: [...matrix], stops: [] };
				Object.defineProperty(gradient, "addColorStop", {
					value: (offset, css) => gradient.stops.push([offset, color(css)]),
				});
				return gradient;
			};
		for (const key of Object.keys(state))
			Object.defineProperty(ctx, key, {
				get: () => state[key],
				set: (value) => (state[key] = value),
			});
		canvas.getContext = () => ctx;
		return canvas;
	};
	return { calls, make };
}

export function original(root, row, record) {
	const context = vm.createContext({ window: {}, structuredClone, URL });
	vm.runInContext(readFileSync(`${root}/core/util.js`, "utf8"), context);
	const Z = context.window.Z;
	Z.canvas = record.make;
	Z.imgSync = () => ({
		width: row.character?.width ?? 320,
		height: row.character?.height ?? 640,
		label: "runner.png",
	});
	Z.scratch = [
		record.make(1920, 1080, "road-runner"),
		record.make(1920, 1080, "road-reflection"),
		record.make(1920, 1080, "unused"),
	];
	Z.tinted = (img, css) => {
		const c = record.make(img.width, img.height, "road-rim-tint"),
			x = c.getContext();
		x.drawImage(img, 0, 0);
		x.globalCompositeOperation = "source-in";
		x.fillStyle = css;
		x.fillRect(0, 0, c.width, c.height);
		return c;
	};
	vm.runInContext(readFileSync(`${root}/core/draw.js`, "utf8"), context);
	const source = readFileSync(`${root}/scenes/memory.js`, "utf8");
	vm.runInContext(
		source.replace(
			/\}\)\(\);\s*$/,
			"window.roadOracle={camera3,rampAt,zk,glints,runGlints,tearPitch,tearCam,dropY,tearTimes,runTimes,runDist,runSpeed,drawRunner,drawRoad,railLine,drawMotes,drawWorld,drawTearDrop,drawTear,drawRun};})();",
		),
		context,
	);
	Z.audio = {
		stops: row.stops.map((start) => ({ start })),
		downbeats: row.downbeats,
	};
	const beats = Array.from({ length: 401 }, (_, i) => i * 0.5),
		clock = Z.makeClock(beats, 120);
	const ctx = record.make(1920, 1080, "main").getContext(),
		fg = record.make(1920, 1080, "foreground").getContext();
	Z.SCENES.road.draw(ctx, {
		t: row.t,
		args: row.args,
		shot: { t0: row.start, t1: row.end },
		clock,
		fg,
	});
	return { functions: context.window.roadOracle, clock };
}

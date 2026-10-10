/** Numerical Canvas-call trace only. This is NOT a rasterizer or font oracle. */
export interface TraceCall {
	readonly method: string;
	readonly args: readonly unknown[];
	readonly state: Readonly<Record<string, unknown>>;
}
export interface Gradient {
	readonly kind: string;
	readonly args: readonly number[];
	readonly stops: [number, string][];
	addColorStop(offset: number, color: string): void;
}
export function isTunnelGradient(value: unknown): value is Gradient {
	return (
		typeof value === "object" &&
		value !== null &&
		"kind" in value &&
		"args" in value &&
		Array.isArray(value.args) &&
		"stops" in value &&
		Array.isArray(value.stops) &&
		value.stops.every(
			(stop: unknown) =>
				Array.isArray(stop) &&
				typeof stop[0] === "number" &&
				typeof stop[1] === "string",
		)
	);
}
export type DeclaredWidth = (input: { text: string; font: string }) => number;
export function tunnelTrace(width: DeclaredWidth) {
	const calls: TraceCall[] = [];
	const stack: (Record<string, unknown> & { operations: unknown[] })[] = [];
	let state: Record<string, unknown> & { operations: unknown[] } = {
		globalAlpha: 1,
		globalCompositeOperation: "source-over",
		filter: "none",
		font: "10px sans-serif",
		letterSpacing: "0px",
		textAlign: "start",
		textBaseline: "alphabetic",
		fillStyle: "#000000",
		strokeStyle: "#000000",
		lineWidth: 1,
		lineCap: "butt",
		lineJoin: "miter",
		operations: [],
	};
	const record = ({
		method,
		args,
	}: {
		method: string;
		args: readonly unknown[];
	}) => calls.push({ method, args, state: { ...state } });
	const gradient = ({
		kind,
		args,
	}: {
		kind: string;
		args: number[];
	}): Gradient => ({
		kind,
		args,
		stops: [],
		// eslint-disable-next-line opencut/prefer-object-params -- Original native CanvasGradient signature.
		addColorStop(offset, color) {
			this.stops.push([offset, color]);
		},
	});
	const methods: Record<string, (...args: never[]) => unknown> = {};
	const api = new Proxy(methods, {
		get(_target, key: string) {
			if (key in state) return state[key];
			if (key === "save") return () => stack.push({ ...state });
			if (key === "restore")
				return () => {
					const prior = stack.pop();
					if (!prior) throw Error("Unbalanced original restore");
					state = prior;
				};
			if (key === "measureText")
				return (text: string) => ({
					width: width({ text, font: String(state.font) }),
				});
			if (key === "createRadialGradient" || key === "createLinearGradient")
				return (...args: number[]) => gradient({ kind: key, args });
			if (key === "createImageData")
				// eslint-disable-next-line opencut/prefer-object-params -- Original native Canvas createImageData signature.
				return (w: number, h: number) => ({
					data: new Uint8ClampedArray(w * h * 4),
				});
			if (key === "createPattern") return () => ({ kind: "pattern" });
			if (["translate", "rotate", "scale", "setTransform"].includes(key))
				return (...args: number[]) => {
					const prior = key === "setTransform" ? [] : state.operations;
					state.operations = [...prior, [key, ...args]];
				};
			return (...args: unknown[]) => record({ method: key, args });
		},
		set(_target, key: string, value) {
			state[key] = value;
			return true;
		},
		has(_target, key: string) {
			return key in state;
		},
	});
	return { api, calls, balanced: () => stack.length === 0 };
}

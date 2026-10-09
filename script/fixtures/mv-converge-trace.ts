/** Test-only observation of native Canvas operations. No draw formula is replaced. */
export interface ConvergePaintTrace {
	readonly op: string;
	readonly args: readonly unknown[];
	readonly transform: readonly number[];
	readonly path: readonly {
		readonly op: string;
		readonly args: readonly unknown[];
	}[];
	readonly style: unknown;
	readonly opacity: number;
	readonly composite: string;
	readonly width: number;
	readonly cap: string;
	readonly join: string;
}
export function traceConvergeCanvas<
	T extends CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
>(native: T) {
	const paints: ConvergePaintTrace[] = [],
		gradients = new WeakMap<object, unknown>();
	let path: { op: string; args: readonly unknown[] }[] = [];
	const matrix = () => {
		const m = native.getTransform();
		return [m.a, m.b, m.c, m.d, m.e, m.f];
	};
	const style = (value: string | CanvasGradient | CanvasPattern) =>
		typeof value === "string"
			? { kind: "css", value }
			: (gradients.get(value) ?? { kind: "pattern" });
	const context = new Proxy(native, {
		get(target, key) {
			const value: unknown = Reflect.get(target, key, target);
			if (typeof value !== "function") return value;
			return (...args: unknown[]) => {
				const op = String(key);
				if (op === "beginPath") path = [];
				else if (
					[
						"moveTo",
						"lineTo",
						"closePath",
						"arc",
						"ellipse",
						"rect",
						"bezierCurveTo",
						"quadraticCurveTo",
					].includes(op)
				)
					path.push({ op, args: [...args] });
				if (["fill", "stroke", "fillRect", "strokeRect"].includes(op)) {
					if (paints.length >= 20000)
						throw Error("Converge trace exceeded bounded paint budget");
					paints.push({
						op,
						args: [...args],
						transform: matrix(),
						path: op.endsWith("Rect") ? [] : [...path],
						style: style(
							op.startsWith("stroke") ? native.strokeStyle : native.fillStyle,
						),
						opacity: native.globalAlpha,
						composite: native.globalCompositeOperation,
						width: native.lineWidth,
						cap: native.lineCap,
						join: native.lineJoin,
					});
				}
				const result: unknown = Reflect.apply(value, target, args);
				if (
					(op === "createRadialGradient" || op === "createLinearGradient") &&
					result &&
					typeof result === "object"
				)
					gradients.set(result, {
						kind: op,
						args: [...args],
						transform: matrix(),
					});
				return result;
			};
		},
		set(target, key, value) {
			return Reflect.set(target, key, value, target);
		},
	});
	return { context, paints };
}

/** Optional fixture observation. Every native call receives the same arguments
 * exactly once; there are no extra draws, measurements or pixel readbacks. */
export function observeTunnelCanvas(ctx: CanvasRenderingContext2D) {
	const records: unknown[] = [];
	const objects = new WeakMap<object, number>();
	let nextId = 0;
	const normalize = (value: unknown): unknown => {
		if (!value || typeof value !== "object") return value;
		if (Array.isArray(value)) return value.map(normalize);
		if (!objects.has(value)) objects.set(value, nextId++);
		return { object: objects.get(value), type: Object.prototype.toString.call(value),
			...(Reflect.has(value, "width") ? { width: Reflect.get(value, "width"), height: Reflect.get(value, "height") } : {}) };
	};
	const state = () => {
		const transform = ctx.getTransform();
		return { transform: [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f],
			font: ctx.font, letterSpacing: ctx.letterSpacing, textAlign: ctx.textAlign,
			textBaseline: ctx.textBaseline, alpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation,
			filter: ctx.filter, lineWidth: ctx.lineWidth, lineCap: ctx.lineCap,
			fillStyle: normalize(ctx.fillStyle), strokeStyle: normalize(ctx.strokeStyle),
			attributes: ctx.getContextAttributes() };
	};
	const proxy = new Proxy(ctx, {
		get(target, key) {
			const value = Reflect.get(target, key, target);
			if (typeof value !== "function") return value;
			return (...args: unknown[]) => {
				const before = state();
				const result = Reflect.apply(value, target, args);
				records.push({ method: String(key), args: args.map(normalize), before,
					...(key === "measureText" ? { width: result.width } : {}) });
				if (key === "createRadialGradient" || key === "createLinearGradient") {
					const gradient: CanvasGradient = result;
					const add = gradient.addColorStop.bind(gradient);
					Object.defineProperty(gradient, "addColorStop", { writable: true, configurable: true, value: (offset: number, color: string) => {
						records.push({ method: "addColorStop", gradient: normalize(gradient), offset, color });
						add(offset, color);
					} });
				}
				return result;
			};
		},
		set(target, key, value) {
			records.push({ set: String(key), value: normalize(value) });
			return Reflect.set(target, key, value, target);
		},
	});
	return { ctx: proxy, records, state };
}

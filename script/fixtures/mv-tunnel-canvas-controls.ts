/** Test-only hostile native platform boundaries; no source or producer math is replaced. */
export interface TunnelCanvasControl {
	readonly name: string;
	readonly applied: Record<string, number>;
}
interface GradientInfo {
	readonly kind: "radial" | "linear";
	readonly args: readonly number[];
	readonly stops: [number, string][];
}
export function controlledTunnelContext({
	ctx,
	control,
	fontRoles = {},
}: {
	ctx: CanvasRenderingContext2D;
	control?: TunnelCanvasControl;
	fontRoles?: Readonly<Record<string, string>>;
}) {
	const gradients = new WeakMap<object, GradientInfo>();
	let vertices = 0,
		moves = 0,
		rect = false,
		clip = false;
	const saves: boolean[] = [];
	const hit = (name: string) => {
		if (control?.name !== name) return false;
		control.applied[name] = (control.applied[name] ?? 0) + 1;
		return true;
	};
	const classify = () => {
		const style = ctx.fillStyle;
		const g = typeof style === "object" ? gradients.get(style) : undefined;
		if (g?.kind === "linear") return "anamorphic";
		if (g?.kind === "radial") {
			if (g.stops.length === 9) return "background";
			if (g.args[5] === 1500) return "rays";
			if (g.args[5] === 1400) return "dawn";
			if (g.args[2] === 324 && g.args[5] === 1134) return "vignette";
			if (g.args[5] === 1350 && g.args[2]! > 0) return "edge-fog";
			if (g.stops.length === 3) return "core";
		}
		if (ctx.globalCompositeOperation === "overlay") return "grain";
		if (style === "#000000" || style === "#000") return "fade";
		if (rect || clip) return "cross";
		return "unknown";
	};
	const proxy = new Proxy(ctx, {
		get(target, key) {
			if (key === "createRadialGradient" || key === "createLinearGradient")
				return (...args: number[]) => {
					const g =
						key === "createRadialGradient"
							? target.createRadialGradient(...tuple6(args))
							: target.createLinearGradient(...tuple4(args));
					const info: GradientInfo = {
						kind: key === "createRadialGradient" ? "radial" : "linear",
						args,
						stops: [],
					};
					gradients.set(g, info);
					const original = g.addColorStop.bind(g);
					// eslint-disable-next-line opencut/prefer-object-params -- Preserve native CanvasGradient positional boundary.
					g.addColorStop = (offset: number, color: string) => {
						let c = color;
						if (
							info.kind === "radial" &&
							args[5] === 1500 &&
							color.startsWith("rgba(0,0,0,") &&
							hit("repair-rays-quirk")
						)
							c = color.replace("rgba(0,0,0,", "rgba(255,190,170,");
						info.stops.push([offset, c]);
						original(offset, c);
					};
					return g;
				};
			if (key === "measureText")
				return (text: string) => {
					const m = target.measureText(text);
					if (
						tunnelCanvasFontRole({ font: target.font, fontRoles }) ===
							"mincho800" &&
						/\b100px\b/.test(target.font) &&
						hit("real-advance")
					)
						return new Proxy(m, {
							get(t, k) {
								return k === "width" ? t.width * 1.2 : Reflect.get(t, k, t);
							},
						});
					return m;
				};
			if (key === "fillText")
				return (...args: Parameters<CanvasRenderingContext2D["fillText"]>) => {
					const admittedRole = tunnelCanvasFontRole({
						font: target.font,
						fontRoles,
					});
					const role =
						admittedRole === "heavy900"
							? "title"
							: admittedRole === "dot400" && /\b18px\b/.test(target.font)
								? "subtitle"
								: admittedRole === "dot400"
									? "latin"
									: "rings";
					if (!hit(role)) target.fillText(...args);
				};
			if (key === "fillRect")
				return (...args: Parameters<CanvasRenderingContext2D["fillRect"]>) => {
					if (!hit(classify())) target.fillRect(...args);
				};
			if (key === "fill")
				return () => {
					const role = classify();
					if (!hit(role) && !(role === "rays" && hit("no-rays-equivalent")))
						target.fill();
				};
			if (key === "stroke")
				return () => {
					const role =
						target.lineCap === "round"
							? "dust"
							: moves >= 20
								? "dial"
								: vertices > 5
									? "circle"
									: "frame";
					if (!hit(role)) target.stroke();
				};
			if (key === "strokeRect")
				return (
					...args: Parameters<CanvasRenderingContext2D["strokeRect"]>
				) => {
					if (!hit("cross")) target.strokeRect(...args);
				};
			if (key === "beginPath")
				return () => {
					vertices = 0;
					moves = 0;
					rect = false;
					target.beginPath();
				};
			if (key === "moveTo" || key === "lineTo" || key === "translate")
				return (...args: number[]) => {
					if (key !== "translate") {
						vertices++;
						if (key === "moveTo") moves++;
					}
					let [x, y] = tuple2(args);
					if (hit("perspective")) {
						x = 960 + (x - 960) * 1.08;
						y = 540 + (y - 540) * 1.08;
					}
					target[key](x, y);
				};
			if (key === "rect")
				return (...args: Parameters<CanvasRenderingContext2D["rect"]>) => {
					rect = true;
					target.rect(...args);
				};
			if (key === "clip")
				return () => {
					clip = true;
					target.clip();
				};
			if (key === "save")
				return () => {
					saves.push(clip);
					target.save();
				};
			if (key === "restore")
				return () => {
					clip = saves.pop() ?? false;
					target.restore();
				};
			const value: unknown = Reflect.get(target, key, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
		set(target, key, value) {
			return Reflect.set(target, key, value, target);
		},
	});
	return proxy;
}
/** Test classification only: Rust still owns all production routing. The first
 * family is the primary face; fallback aliases must not change the role. */
export function tunnelCanvasFontRole({
	font,
	fontRoles,
}: {
	font: string;
	fontRoles: Readonly<Record<string, string>>;
}) {
	const family = font
		.slice(font.search(/\b[\d.]+px\b/))
		.replace(/^[\d.]+px\s*/, "")
		.split(",")[0]!
		.trim()
		.replace(/^['"]|['"]$/g, "");
	if (fontRoles[family]) return fontRoles[family];
	if (family === "DotGothic16") return "dot400";
	if (/\b900\b/.test(font)) return "heavy900";
	if (/\b800\b/.test(font)) return "mincho800";
	return undefined;
}
function tuple2(v: number[]): [number, number] {
	if (v.length !== 2) throw Error("Native point arity");
	return [v[0]!, v[1]!];
}
function tuple4(v: number[]): [number, number, number, number] {
	if (v.length !== 4) throw Error("Native linear arity");
	return [v[0]!, v[1]!, v[2]!, v[3]!];
}
function tuple6(v: number[]): [number, number, number, number, number, number] {
	if (v.length !== 6) throw Error("Native radial arity");
	return [v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!];
}

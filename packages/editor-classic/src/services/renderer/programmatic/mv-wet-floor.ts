import type {
	MvWetFloorOperation,
	MvWetFloorPlan,
} from "../../../../../editor-contracts/src/mv-wet-floor";

interface BoundFont {
	readonly resourceId: string;
	readonly face: FontFace;
}
interface BoundImage {
	readonly resourceId: string;
	readonly image: CanvasImageSource;
}
/** Pure native Canvas ABI transport. All scene, clock, font routing, random and
 * pixel-analysis decisions come from the admitted Rust plan. */
export function renderWetFloor({
	canvas,
	plan,
	image,
	fonts,
	onSurface,
}: {
	readonly canvas: HTMLCanvasElement;
	readonly plan: MvWetFloorPlan;
	readonly image: BoundImage;
	readonly fonts: readonly BoundFont[];
	/** Optional fixture-only diagnostics: invoked with the completed surface
	 * canvas before the retained surfaces are released. Production callers
	 * omit it, which preserves the existing behavior exactly. */
	readonly onSurface?: (surface: {
		readonly id: string;
		readonly canvas: HTMLCanvasElement;
	}) => void;
}): void {
	if (plan.version !== 1 || plan.profile !== "night-wet-floor-v1")
		throw Error("Unsupported wetFloor native plan");
	const stacks = new Map<string, string>();
	for (const stack of plan.fontStacks) {
		stack.resources.forEach((resource, index) => {
			const binding = fonts.find((font) => font.resourceId === resource.id);
			const alias = stack.aliases[index];
			if (
				!binding ||
				binding.face.status !== "loaded" ||
				!document.fonts.has(binding.face) ||
				binding.face.family.replace(/^['"]|['"]$/g, "") !== alias
			)
				throw Error("wetFloor exact admitted FontFace unavailable");
		});
		stacks.set(
			stack.role,
			stack.aliases.map((alias) => `"${alias}"`).join(","),
		);
	}
	const surfaces = new Map<string, HTMLCanvasElement>();
	function execute({
		target,
		operations,
	}: {
		target: HTMLCanvasElement;
		operations: readonly MvWetFloorOperation[];
	}): void {
		const ctx = target.getContext("2d");
		if (!ctx) throw Error("wetFloor Canvas2D unavailable");
		const gradients = new Map<string, CanvasGradient>();
		function brush(
			value: Extract<
				MvWetFloorOperation,
				{ op: "fillStyle" | "strokeStyle" }
			>["brush"],
		): string | CanvasGradient {
			if (value.kind === "color") return value.value;
			const gradient = gradients.get(value.id);
			if (!gradient) throw Error("wetFloor missing native gradient");
			return gradient;
		}
		for (const op of operations) {
			switch (op.op) {
				case "save":
					ctx.save();
					break;
				case "restore":
					ctx.restore();
					break;
				case "beginPath":
					ctx.beginPath();
					break;
				case "closePath":
					ctx.closePath();
					break;
				case "translate":
					ctx.translate(...op.point);
					break;
				case "scale":
					ctx.scale(...op.point);
					break;
				case "moveTo":
					ctx.moveTo(...op.point);
					break;
				case "lineTo":
					ctx.lineTo(...op.point);
					break;
				case "rotate":
					ctx.rotate(op.angle);
					break;
				case "setTransform":
					ctx.setTransform(...op.matrix);
					break;
				case "alpha":
					ctx.globalAlpha = op.value;
					break;
				case "lineWidth":
					ctx.lineWidth = op.value;
					break;
				case "shadowBlur":
					ctx.shadowBlur = op.value;
					break;
				case "shadowColor":
					ctx.shadowColor = op.value;
					break;
				case "filter":
					ctx.filter = op.value;
					break;
				case "composite":
					if (
						op.value !== "source-over" &&
						op.value !== "lighter" &&
						op.value !== "multiply" &&
						op.value !== "destination-in"
					)
						throw Error("wetFloor unsupported native composite");
					ctx.globalCompositeOperation = op.value;
					break;
				case "lineCap":
					if (op.value !== "round")
						throw Error("wetFloor unsupported native cap");
					ctx.lineCap = op.value;
					break;
				case "textAlign":
					if (
						op.value !== "left" &&
						op.value !== "center" &&
						op.value !== "right"
					)
						throw Error("wetFloor unsupported native text alignment");
					ctx.textAlign = op.value;
					break;
				case "textBaseline":
					if (op.value !== "middle")
						throw Error("wetFloor unsupported native text baseline");
					ctx.textBaseline = op.value;
					break;
				case "lineDash":
					ctx.setLineDash([...op.values]);
					break;
				case "fillStyle":
					ctx.fillStyle = brush(op.brush);
					break;
				case "strokeStyle":
					ctx.strokeStyle = brush(op.brush);
					break;
				case "linearGradient": {
					const gradient = ctx.createLinearGradient(...op.points);
					for (const [offset, color] of op.stops)
						gradient.addColorStop(offset, color);
					gradients.set(op.id, gradient);
					break;
				}
				case "radialGradient": {
					const gradient = ctx.createRadialGradient(...op.points);
					for (const [offset, color] of op.stops)
						gradient.addColorStop(offset, color);
					gradients.set(op.id, gradient);
					break;
				}
				case "rect":
					ctx.rect(...op.rect);
					break;
				case "fillRect":
					ctx.fillRect(...op.rect);
					break;
				case "clearRect":
					ctx.clearRect(...op.rect);
					break;
				case "ellipse":
					ctx.ellipse(...op.center, ...op.radii, op.rotation, op.start, op.end);
					break;
				case "clip":
					ctx.clip(op.rule);
					break;
				case "fill":
					ctx.fill(op.rule);
					break;
				case "stroke":
					ctx.stroke();
					break;
				case "drawImage": {
					const source =
						op.image.kind === "surface"
							? surfaces.get(op.image.id)
							: op.image.id === image.resourceId
								? image.image
								: undefined;
					if (!source) throw Error("wetFloor unbound native image");
					if (op.sourceRect)
						ctx.drawImage(source, ...op.sourceRect, ...op.destinationRect);
					else ctx.drawImage(source, ...op.destinationRect);
					break;
				}
				case "font": {
					const stack = stacks.get(op.role);
					if (!stack) throw Error("wetFloor unbound native font stack");
					ctx.font = `${op.weight} ${op.size}px ${stack}`;
					break;
				}
				case "fillText":
					ctx.fillText(op.text, ...op.point);
					break;
				case "putRgba":
				case "putAlpha": {
					const data = ctx.createImageData(...op.size);
					if (op.op === "putRgba") data.data.set(op.bytes);
					else
						for (let index = 0; index < op.bytes.length; index++) {
							const offset = index * 4;
							data.data[offset] =
								data.data[offset + 1] =
								data.data[offset + 2] =
									255;
							data.data[offset + 3] = op.bytes[index];
						}
					ctx.putImageData(data, 0, 0);
					break;
				}
				default:
					throw Error("Unsupported wetFloor native primitive");
			}
		}
	}
	try {
		for (const surface of plan.surfaces) {
			const target = document.createElement("canvas");
			target.width = surface.size[0];
			target.height = surface.size[1];
			try {
				execute({ target, operations: surface.operations });
			} catch (error) {
				target.width = target.height = 1;
				throw error;
			}
		onSurface?.({ id: surface.id, canvas: target });
			surfaces.set(surface.id, target);
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) throw Error("wetFloor output Canvas2D unavailable");
		ctx.save();
		try {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.globalAlpha = 1;
			ctx.globalCompositeOperation = "source-over";
			ctx.filter = "none";
			ctx.shadowBlur = 0;
			ctx.lineWidth = 1;
			ctx.lineCap = "butt";
			ctx.setLineDash([]);
			ctx.scale(canvas.width / 1920, canvas.height / 1080);
			execute({ target: canvas, operations: plan.operations });
		} finally {
			ctx.restore();
		}
	} finally {
		for (const surface of surfaces.values()) {
			surface.width = surface.height = 1;
		}
		surfaces.clear();
	}
}

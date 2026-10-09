import type {
	MvEmberCommand,
	MvEmberPlan,
	MvEmberSurfaceDraw,
} from "../../packages/editor-contracts/src/mv-ember-plan";
import { size } from "./mv-surface-fixture";

const gray = [
	0, 255, 0, 255, 20, 230, 80, 180, 255, 0, 255, 0, 230, 20, 180, 80, 0, 255,
	40, 210, 0, 255, 0, 255, 255, 0, 210, 40, 255, 0, 255, 0, 20, 230, 0, 255, 80,
	180, 10, 245, 230, 20, 255, 0, 180, 80, 245, 10,
];
const transform = [1, 0, 0, 1, 0, 0] as const;
const upload = {
	kind: "grayPixels",
	size: [8, 6],
	gray,
	position: [0, 0],
} as const satisfies MvEmberSurfaceDraw;
function blit(surface: string): MvEmberCommand & { kind: "blit" } {
	return {
		kind: "blit",
		surface,
		transform,
		sourceRect: [0, 0, size, size],
		destinationRect: [0, 0, size, size],
		composite: "source-over",
		opacity: 1,
	};
}

/** Controlled fixture only: these are internal primitive plans, not author input. */
export function pixelPlan(retain = false): MvEmberPlan {
	const commands: MvEmberCommand[] = [
		{ kind: "surface", id: "unused", size: [32, 32], commands: [upload] },
		{ kind: "releaseSurface", surface: "unused" },
		{ kind: "surface", id: "pixels", size: [8, 6], commands: [upload] },
		{
			kind: "surface",
			id: "scaled",
			size: [size, size],
			commands: [
				{
					...blit("pixels"),
					sourceRect: [0, 0, 8, 6],
					destinationRect: [9.25, 7.5, 70, 34],
					raster: { blurPx: 0, smoothing: false, smoothingQuality: "low" },
				},
				{
					...blit("pixels"),
					sourceRect: [0, 0, 8, 6],
					destinationRect: [14.25, 52.5, 65, 32],
					raster: { blurPx: 0, smoothing: true, smoothingQuality: "high" },
				},
			],
		},
		{ kind: "releaseSurface", surface: "pixels" },
		{
			kind: "surface",
			id: "blurred",
			size: [size, size],
			commands: [
				{
					...blit("scaled"),
					raster: { blurPx: 2.75, smoothing: true, smoothingQuality: "high" },
				},
			],
		},
		{ kind: "releaseSurface", surface: "scaled" },
		{
			kind: "rect",
			transform,
			rect: [0, 0, size, size],
			paint: {
				kind: "fill",
				composite: "source-over",
				opacity: 1,
				style: { kind: "solid", color: [23 / 255, 35 / 255, 52 / 255, 1] },
			},
		},
		blit("blurred"),
		{ kind: "releaseSurface", surface: "blurred" },
	];
	return {
		commands: retain
			? commands.filter((command) => command.kind !== "releaseSurface")
			: commands,
	};
}

/** Handwritten HTMLCanvas oracle; no fixed renderer helper or plan traversal. */
export function originalPixels() {
	const make = (width: number, height: number) => {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		return canvas;
	};
	const pixels = make(8, 6),
		scaled = make(size, size),
		blurred = make(size, size),
		output = make(size, size);
	try {
		const p = pixels.getContext("2d")!,
			s = scaled.getContext("2d")!;
		const b = blurred.getContext("2d")!,
			o = output.getContext("2d")!;
		const data = p.createImageData(8, 6);
		for (let index = 0; index < 48; index++)
			data.data.set([gray[index]!, gray[index]!, gray[index]!, 255], index * 4);
		p.putImageData(data, 0, 0);
		s.imageSmoothingEnabled = false;
		s.imageSmoothingQuality = "low";
		s.drawImage(pixels, 0, 0, 8, 6, 9.25, 7.5, 70, 34);
		s.imageSmoothingEnabled = true;
		s.imageSmoothingQuality = "high";
		s.drawImage(pixels, 0, 0, 8, 6, 14.25, 52.5, 65, 32);
		b.filter = "blur(2.75px)";
		b.imageSmoothingEnabled = true;
		b.imageSmoothingQuality = "high";
		b.drawImage(scaled, 0, 0, size, size, 0, 0, size, size);
		o.fillStyle = "rgb(23,35,52)";
		o.fillRect(0, 0, size, size);
		o.drawImage(blurred, 0, 0, size, size, 0, 0, size, size);
		return o.getImageData(0, 0, size, size).data;
	} finally {
		for (const canvas of [pixels, scaled, blurred, output])
			canvas.width = canvas.height = 1;
	}
}

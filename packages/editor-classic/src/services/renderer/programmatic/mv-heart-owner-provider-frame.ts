import type {
	MvHeartOwnerFrame,
	MvHeartSkyOwnerFrame,
	MvHeartNativeOwnerFrame,
	MvHeartOwnerCommand,
	MvHeartSkyCommand,
} from "../../../../../editor-contracts/src/mv-heart-plan";
import { object, keys, key, image } from "./mv-heart-owner-provider-protocol";

function finite(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}
function vector({ value, length }: { value: unknown; length: number }) {
	return Array.isArray(value) && value.length === length && value.every(finite);
}
/** The Rust owner is the command producer and performs complete geometry,
 * publication, lifetime and raster admission. This boundary also fails closed
 * on an unknown wire kind, substituted images and forbidden Sky crops/appends. */
function draw({ value, sky }: { value: unknown; sky: boolean }): boolean {
	if (!object(value)) return false;
	if (value.kind === "grayPixels" || value.kind === "alphaPixels")
		return (
			vector({ value: value.size, length: 2 }) &&
			vector({ value: value.position, length: 2 }) &&
			Array.isArray(value.kind === "grayPixels" ? value.gray : value.alpha)
		);
	if (!vector({ value: value.transform, length: 6 })) return false;
	if (value.operations !== undefined && !Array.isArray(value.operations))
		return false;
	switch (value.kind) {
		case "preparedImage":
			return (
				!sky &&
				image(value.image) &&
				vector({ value: value.destinationRect, length: 4 })
			);
		case "image":
			return (
				typeof value.image === "string" &&
				vector({ value: value.destinationRect, length: 4 })
			);
		case "blit":
			return (
				typeof value.surface === "string" &&
				vector({ value: value.sourceRect, length: 4 }) &&
				vector({ value: value.destinationRect, length: 4 })
			);
		case "surfacePatternRect":
			return (
				typeof value.surface === "string" &&
				vector({ value: value.rect, length: 4 })
			);
		case "filteredPath":
			return (
				sky &&
				key(value.transform) === "[1,0,0,1,0,0]" &&
				Array.isArray(value.operations) &&
				value.operations.length === 0 &&
				value.blurPx === 10 &&
				Array.isArray(value.path) &&
				Array.isArray(value.paints) &&
				value.paints.length === 1
			);
		case "shadowPath":
			return (
				Array.isArray(value.path) &&
				Array.isArray(value.paints) &&
				object(value.shadow) &&
				finite(value.shadow.blurPx)
			);
		case "path":
			return Array.isArray(value.path) && Array.isArray(value.paints);
		case "circleBatch":
			return Array.isArray(value.circles) && Array.isArray(value.paints);
		case "rect":
		case "filteredRect":
			return vector({ value: value.rect, length: 4 }) && object(value.paint);
		case "rectBatch":
			return Array.isArray(value.rects) && object(value.paint);
		case "gradientRect":
			return vector({ value: value.rect, length: 4 });
		case "grain":
			return (
				vector({ value: value.rect, length: 4 }) && Array.isArray(value.gray)
			);
		case "text":
		case "textStroke":
			return typeof value.text === "string";
		case "preparedPatch":
			return false;
		default:
			return false;
	}
}
function command({ value, sky }: { value: unknown; sky: boolean }): boolean {
	if (!object(value)) return false;
	if (value.kind === "releaseSurface") return typeof value.surface === "string";
	if (value.kind === "surface" || value.kind === "appendSurface") {
		if (value.kind === "appendSurface" && sky) return false;
		return (
			(value.kind === "surface"
				? typeof value.id === "string" &&
					vector({ value: value.size, length: 2 })
				: typeof value.surface === "string") &&
			Array.isArray(value.commands) &&
			value.commands.every((child: unknown) => draw({ value: child, sky }))
		);
	}
	return draw({ value, sky });
}
function heartFrame(v: unknown): v is MvHeartOwnerFrame {
	return (
		object(v) &&
		keys({ value: v, expected: ["identity", "plan"] }) &&
		object(v.plan) &&
		finite(v.plan.rasterBudgetBytes) &&
		Array.isArray(v.plan.commands) &&
		v.plan.commands.every((value: unknown) => command({ value, sky: false }))
	);
}
function skyFrame(v: unknown): v is MvHeartSkyOwnerFrame {
	return (
		object(v) &&
		keys({ value: v, expected: ["kind", "identity", "plan"] }) &&
		v.kind === "skyShatter" &&
		object(v.plan) &&
		finite(v.plan.rasterBudgetBytes) &&
		Array.isArray(v.plan.commands) &&
		v.plan.commands.every((value: unknown) => command({ value, sky: true }))
	);
}
export function readOwnerFrame({
	value,
	identity,
	sky,
	hasPreparedImage,
	resources,
}: {
	value: unknown;
	identity: unknown;
	sky: boolean;
	hasPreparedImage: (image: unknown) => boolean;
	resources: ReadonlySet<string>;
}): MvHeartNativeOwnerFrame {
	if (
		!object(value) ||
		key(value.identity) !== key(identity) ||
		(sky ? !skyFrame(value) : !heartFrame(value))
	)
		throw Error("Heart frame owner identity mismatch");
	if (!heartFrame(value) && !skyFrame(value))
		throw Error("Heart frame wire malformed");
	const inspect = (
		commands: readonly (MvHeartOwnerCommand | MvHeartSkyCommand)[],
	) => {
		for (const command of commands) {
			if (command.kind === "preparedImage" && !hasPreparedImage(command.image))
				throw Error("Heart frame substituted derived image identity");
			if (command.kind === "image" && !resources.has(command.image))
				throw Error("Heart frame substituted native image identity");
			if (command.kind === "surface" || command.kind === "appendSurface")
				inspect(command.commands);
		}
	};
	inspect(value.plan.commands);
	return value;
}

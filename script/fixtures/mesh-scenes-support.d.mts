import type {
	MvRecipe,
	MvScene,
	MvSpan,
	MvTransition,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type {
	MeshImages,
	MeshPixelComparison,
	MeshPixelOptions,
} from "./mesh-scenes-contract";

type PixelBytes = Uint8Array | Uint8ClampedArray;
type Rgba = readonly [number, number, number, number];
type SourceSettings = Partial<Omit<ProgrammaticSource, "resources" | "recipe">>;
type RecipeSource = ProgrammaticSource & { recipe: MvRecipe };

export function assert(value: unknown, message?: string): asserts value;
export function freshMeshImage(image: ImageBitmap): Promise<ImageBitmap>;
export function imagePixels(
	image: CanvasImageSource,
	width: number,
	height: number,
): Uint8ClampedArray;
export function sampleRgba(
	pixels: PixelBytes,
	width: number,
	height: number,
	u: number,
	v: number,
): [number, number, number, number];
export function over(
	top: Rgba | PixelBytes,
	bottom: Rgba | PixelBytes,
): [number, number, number, number];
export function comparePixels(
	actual: PixelBytes,
	expected: PixelBytes,
	options?: MeshPixelOptions,
): MeshPixelComparison;
export function makeMeshAssets(): Promise<{
	resources: ResolvedProgrammaticResource[];
	images: MeshImages;
	sourceChecks: MeshPixelComparison[];
}>;
export function sceneSource(
	resources: readonly ResolvedProgrammaticResource[],
	scene: MvScene,
	settings?: SourceSettings,
): RecipeSource;
export function transitionSource(
	resources: readonly ResolvedProgrammaticResource[],
	style: MvTransition,
	settings?: SourceSettings,
	span?: MvSpan,
): RecipeSource;
export function base64(bytes: PixelBytes): string;
export function opaqueOracle(
	pixels: PixelBytes,
	background?: Rgba,
): Uint8ClampedArray;

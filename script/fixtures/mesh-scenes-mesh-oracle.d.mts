export interface MeshRasterVertex {
	readonly position: readonly [number, number];
	readonly uv: readonly [number, number];
	readonly w: number;
}

export interface MeshRasterFace {
	readonly vertices: readonly MeshRasterVertex[];
	readonly brightness: number;
	readonly opacity: number;
}

export function rasterMesh(options: {
	faces: readonly MeshRasterFace[];
	texture: Uint8Array | Uint8ClampedArray;
	width: number;
	height: number;
	edgeMargin?: number;
}): {
	pixels: Uint8ClampedArray;
	mask: Uint8Array;
	coveredSamples: number;
};

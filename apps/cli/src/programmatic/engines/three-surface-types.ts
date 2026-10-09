export type V2 = [number, number];
export type V3 = [number, number, number];
export type V4 = [number, number, number, number];
export interface Vector {
	x: number;
	y: number;
	z: number;
	clone(): Vector;
	set(x: number, y: number, z: number): Vector;
	applyMatrix4(matrix: Matrix): Vector;
	applyNormalMatrix(matrix: NormalMatrix): Vector;
	length(): number;
}
export interface Matrix {
	elements: number[];
	clone(): Matrix;
	compose(
		position: Vector,
		quaternion: { x: number; y: number; z: number; w: number },
		scale: Vector,
	): Matrix;
	multiplyMatrices(parent: Matrix, local: Matrix): Matrix;
	determinant(): number;
}
export interface NormalMatrix {
	elements: number[];
	clone(): NormalMatrix;
	getNormalMatrix(matrix: Matrix): NormalMatrix;
}
export interface Attribute {
	isBufferAttribute?: boolean;
	isInterleavedBufferAttribute?: boolean;
	isInstancedBufferAttribute?: boolean;
	itemSize: number;
	count: number;
	normalized?: boolean;
	offset?: number;
	array: ArrayBufferView & { length: number };
	data?: { stride: number; isInstancedInterleavedBuffer?: boolean };
	getX(index: number): number;
	getY(index: number): number;
	getZ(index: number): number;
	getW(index: number): number;
}
export interface Geometry {
	isBufferGeometry: boolean;
	isInstancedBufferGeometry?: boolean;
	attributes: Record<string, Attribute | undefined>;
	index: Attribute | null;
	groups: { start: number; count: number; materialIndex?: number }[];
	drawRange: { start: number; count: number };
}
export interface ThreeSurfaceMaterial {
	isMaterial: boolean;
	visible: boolean;
	wireframe?: boolean;
	displacementMap?: unknown;
	isShaderMaterial?: boolean;
	isRawShaderMaterial?: boolean;
}
/** Minimal r185 Object3D protocol; constructors stay in the controlled Three bundle. */
export interface ThreeSurfaceObject {
	isObject3D: boolean;
	visible: boolean;
	parent: ThreeSurfaceObject | null;
	children: ThreeSurfaceObject[];
	matrix: Matrix;
	matrixWorld: Matrix;
	normalMatrix: NormalMatrix;
	matrixAutoUpdate: boolean;
	matrixWorldAutoUpdate: boolean;
	position: Vector;
	scale: Vector;
	quaternion: { x: number; y: number; z: number; w: number };
	isMesh?: boolean;
	isSkinnedMesh?: boolean;
	isInstancedMesh?: boolean;
	isBatchedMesh?: boolean;
	isLine?: boolean;
	isPoints?: boolean;
	isSprite?: boolean;
	isLOD?: boolean;
	geometry?: Geometry;
	material?: ThreeSurfaceMaterial | ThreeSurfaceMaterial[];
	morphTargetInfluences?: number[];
}
export interface ThreeSurfaceTriangle {
	position: [V3, V3, V3];
	normal?: [V3, V3, V3];
	uv?: [V2, V2, V2];
	color?: [V4, V4, V4];
	primitiveIndex: number;
	materialIndex: number;
}
export interface ThreeSurfacePrimitive {
	mesh: ThreeSurfaceObject;
	groupIndex: number | null;
	materialSlot: number;
	materialIndex: number;
	triangleStart: number;
	triangleCount: number;
}
export interface ThreeSurfaceLimits {
	maxTriangles?: number;
	maxWorkingBytes?: number;
	maxObjects?: number;
	maxGeometryBytes?: number;
}
export interface SurfacePlan {
	mesh: ThreeSurfaceObject;
	matrix: Matrix;
	normal: NormalMatrix;
	geometry: Geometry;
	start: number;
	end: number;
	mirrored: boolean;
	primitive: ThreeSurfacePrimitive;
}

/** Native Rust-produced closed compositor plan, never authored shader policy. */
export interface ReferencePostPlan {
	readonly profile: "tunnel-original-gl-v1" | "road-original-gl-v1";
	readonly required: true;
	readonly width: number;
	readonly height: number;
	readonly songTicks: number;
	readonly allocationBytes: number;
	readonly lutAtlasRequired: boolean;
	readonly targets: readonly {
		readonly name: string;
		readonly width: number;
		readonly height: number;
	}[];
	readonly passes: readonly {
		readonly shader: "comp" | "bright" | "blur" | "final";
		readonly target: string | null;
		readonly uniforms: Readonly<Record<string, number | readonly number[]>>;
		readonly textures: Readonly<Record<string, string>>;
	}[];
}

export type MvConvergeTransform = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
];

/** Rust-evaluated parameters replayed with native Canvas APIs. Flattening these
 * into setTransform loses Canvas's per-operation numeric precision semantics. */
export type MvConvergeTransformOp =
	| { readonly kind: "translate"; readonly offset: readonly [number, number] }
	| { readonly kind: "rotate"; readonly radians: number }
	| { readonly kind: "scale"; readonly factors: readonly [number, number] }
	/** Copy the replayed CTM through Canvas's DOMMatrix setTransform overload. */
	| { readonly kind: "copyTransform" };

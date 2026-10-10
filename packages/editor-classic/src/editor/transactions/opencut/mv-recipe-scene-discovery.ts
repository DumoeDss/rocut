/** Describe only kinds advertised by the loaded Rust binary. Older runtimes
 * may omit owner/reference groups; frontend source alone cannot add support. */
export function mvRecipeSceneKinds(extensions: {
	generators: Readonly<Record<string, unknown>>;
	nativeOwnerScenes?: Readonly<Record<string, unknown>>;
	referenceScenes?: Readonly<Record<string, unknown>>;
}): string[] {
	return [
		...new Set([
			"solid",
			"illust",
			"transition",
			"ref",
			"sequence",
			"panels",
			"imageSequence",
			...Object.keys(extensions.generators),
			...Object.keys(extensions.nativeOwnerScenes ?? {}),
			...Object.keys(extensions.referenceScenes ?? {}),
		]),
	];
}

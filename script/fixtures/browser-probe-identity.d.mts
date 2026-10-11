export function resolveProbeBrowserExecutable(args: {
	configured?: string;
	fallback: string;
}): string;
export function resolveRequiredProbeWasmBinding(args: {
	directory?: string;
	expectedWasmSha256?: string;
}): {
	directory: string;
	entry: string;
	identity: {
		directory: string;
		files: { name: string; byteLength: number; sha256: string }[];
	};
};

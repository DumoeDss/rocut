import type { MvPreparedPatchCommand } from "@opencut/editor-contracts";
import { sameImagePreprocessStructure } from "./image-preprocess-identity";
import type { MvNativeRasterInput } from "./mv-native-admission";
import { imagePreprocessCommands } from "./image-preprocess-binding";
import type {
	ImagePreprocessAccess,
	ImagePreprocessLease,
} from "./image-preprocess-owner";

export interface ImagePreprocessPatch {
	readonly patchKey: string;
	readonly envelope: Uint8Array;
}

/** Admission already owns digest-verified snapshots. A request must match the
 * full declared image and actual dimensions used by canonical Rust evaluation. */
export async function prepareImagePreprocessPatches({
	input,
	owner,
	signal,
}: {
	input: MvNativeRasterInput;
	owner: ImagePreprocessAccess;
	signal: AbortSignal;
}): Promise<{ patches: ImagePreprocessPatch[]; release: () => void }> {
	const commands = imagePreprocessCommands(input.frame.recipePlan);
	const unique = new Map<string, MvPreparedPatchCommand>();
	for (const command of commands) {
		const previous = unique.get(command.patchKey);
		if (
			previous &&
			!sameImagePreprocessStructure({
				left: previous.request,
				right: command.request,
			})
		)
			throw Error("Conflicting preprocessing identity");
		unique.set(command.patchKey, command);
	}
	const patches: ImagePreprocessPatch[] = [];
	const leases: ImagePreprocessLease[] = [];
	const release = () => {
		for (const lease of leases) lease.release();
		leases.length = 0;
	};
	try {
		for (const command of unique.values()) {
			signal.throwIfAborted();
			const { binding } = command.request;
			const resources = input.resources.filter((item) =>
				sameImagePreprocessStructure({
					left: item.resource,
					right: binding.resource,
				}),
			);
			const admissions = input.imageAdmissions.filter((item) =>
				sameImagePreprocessStructure({
					left: item.resource,
					right: binding.resource,
				}),
			);
			if (
				resources.length !== 1 ||
				admissions.length !== 1 ||
				!input.frame.imageDecodeLimits
			)
				throw Error("Preprocess request requires one admitted declared image");
			const lease = await owner.prepare({
				command,
				signal,
				input: {
					request: command.request,
					item: resources[0],
					admission: admissions[0],
					limits: input.frame.imageDecodeLimits,
				},
			});
			leases.push(lease);
			patches.push({ patchKey: command.patchKey, envelope: lease.buffer });
		}
		return { patches, release };
	} catch (error) {
		release();
		throw error;
	}
}

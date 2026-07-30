/**
 * **PROVISIONAL — NOT A HOST PORT CONTRACT. SUPERSEDED IN S02.**
 *
 * Do not build against this as though it were stable. It exists to give S01 a
 * single named place where a *host* touches browser persistence, so §3.5 has a
 * boundary to point at and the scan in `script/check-storage-boundary.mjs` has
 * something to enforce. It is a facade over `storageService` and nothing more:
 * no new behaviour, no new storage semantics, no inverted dependency.
 *
 * What S02 does with it — designing the real Host port, inverting the
 * dependency so the editor receives storage instead of importing it, and
 * introducing Sessions — is explicitly excluded from this Slice (spec §5).
 * Rewiring the fifteen existing `storageService` importers now would be that
 * work under another name, and would put the parity baseline at risk for no
 * S01 evidence.
 *
 * So: the internal adapters (`indexeddb-adapter.ts`, `opfs-adapter.ts`,
 * `quota.ts`, `service.ts`) are untouched, editor code keeps importing
 * `storageService` directly, and only *host* code is required to come through
 * here.
 */
import { storageService } from "./service";
import { readStorageQuotaStatus } from "./quota";
import type { TProjectMetadata } from "@/project/types";

/**
 * Byte figures are nullable because `navigator.storage.estimate()` is not
 * universally available and returns nothing useful when it is not. A host must
 * render "unknown" rather than assume zero — reporting 0 bytes used when the
 * browser declined to answer is worse than saying nothing.
 */
export interface BrowserStorageInfo {
	projectCount: number;
	usageBytes: number | null;
	quotaBytes: number | null;
	availableBytes: number | null;
	isOPFSSupported: boolean;
	isIndexedDBSupported: boolean;
}

export const BrowserHostAdapter = {
	/**
	 * Project metadata for a host's own project list.
	 *
	 * Metadata only, deliberately. A host rendering a list of names should not
	 * have to deserialize every scene of every project to do it.
	 */
	async listProjects(): Promise<TProjectMetadata[]> {
		return storageService.loadAllProjectsMetadata();
	},

	/** Remove a project and everything stored under it. */
	async deleteProject({ id }: { id: string }): Promise<void> {
		await storageService.deleteProject({ id });
		await storageService.deleteProjectMedia({ projectId: id });
	},

	/** Project count, backend support and byte usage, for surfacing quota pressure. */
	async getStorageInfo(): Promise<BrowserStorageInfo> {
		const [info, quota] = await Promise.all([
			storageService.getStorageInfo(),
			readStorageQuotaStatus(),
		]);

		return {
			projectCount: info.projects,
			usageBytes: quota.usageBytes,
			quotaBytes: quota.quotaBytes,
			availableBytes: quota.availableBytes,
			isOPFSSupported: info.isOPFSSupported,
			isIndexedDBSupported: info.isIndexedDBSupported,
		};
	},

	/**
	 * Whether this browser has both storage backends the editor relies on.
	 * A host should check before offering to create a project.
	 */
	isSupported(): boolean {
		return storageService.isFullySupported();
	},
};

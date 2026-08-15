/**
 * The export port.
 *
 * Declared rather than omitted, and deliberately so. Nothing in S02's acceptance
 * exercises export and **S08 owns production export**, so the honest options
 * were "leave a Target State §5.5 role silently absent from the surface" or
 * "declare the role and record where its semantics live". A Host author reading
 * the contract should be able to see the whole shape of what a Host is, and a
 * role that arrives later as a surprise is the thing a single coherent surface
 * exists to prevent.
 *
 * The in-memory reference implementation therefore reports **unsupported**, and
 * that is a conforming answer, not a stub: `unsupported` is a state a real Host
 * genuinely occupies.
 */
import type { ProjectId } from "./identity";

export interface ExportRequest {
	readonly projectId: ProjectId;
	/** A container hint, e.g. `"mp4"`. Opaque to the contract; S08 fixes the set. */
	readonly format: string;
}

export type ExportOutcome =
	| { readonly status: "unsupported"; readonly reason: string }
	| { readonly status: "completed"; readonly bytes: ArrayBuffer }
	| { readonly status: "failed"; readonly reason: string };

export interface ExportProvider {
	/**
	 * Whether this Host can export at all, askable before a user is offered the
	 * option. Same reasoning as `EditorHostServices`' absent endpoints: absence
	 * has to be declarable rather than discovered by a request that appears to
	 * succeed.
	 */
	canExport(args: { request: ExportRequest }): boolean;
	export(args: { request: ExportRequest }): Promise<ExportOutcome>;
}

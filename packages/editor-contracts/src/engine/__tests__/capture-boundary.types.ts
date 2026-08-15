type Assert<Condition extends true> = Condition;

type EngineConstructionModule = typeof import("../engine");
type ProjectionModule = typeof import("../projection");
type AllowedEngineConstructionExport =
	| "bindNativeCommittedTransactionStateCapture"
	| "openTransactionEngine";
type AllowedProjectionExport = "projectCommittedTransactionDocument";

/** Compile-time regression: no deep importer can acquire a registry writer. */
export type NativeCaptureWriterIsNotExported = Assert<
	"registerNativeCommittedStateCapture" extends keyof EngineConstructionModule
		? false
		: true
>;

export type LegacyCaptureWriterIsNotExported = Assert<
	"registerCommittedTransactionStateCapture" extends
		| keyof EngineConstructionModule
		| keyof ProjectionModule
		? false
		: true
>;

/** Any new runtime export from either internal module requires a boundary audit. */
export type EngineConstructionHasNoGeneralMutationSurface = Assert<
	Exclude<
		keyof EngineConstructionModule,
		AllowedEngineConstructionExport
	> extends never
		? true
		: false
>;

export type ProjectionHasNoGeneralMutationSurface = Assert<
	Exclude<keyof ProjectionModule, AllowedProjectionExport> extends never
		? true
		: false
>;

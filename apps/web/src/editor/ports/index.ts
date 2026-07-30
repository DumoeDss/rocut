/**
 * The Host port contract — one entry point, one coherent surface.
 *
 * Every port role is reachable from here. Adding a role widens this surface; it
 * never introduces a parallel object beside it. See `DECISIONS.md` in this
 * directory for the four port-shape decisions and the measurements that forced
 * them.
 *
 * **Nothing in this module is wired.** It is consumed by
 * `apps/web/src/editor/session/`, its in-memory reference implementation and its
 * conformance suite, and by nothing else. `EditorCore` is untouched.
 *
 * The boundary rule, enforced by `script/check-port-boundary.mjs` rather than by
 * review: no port signature references an OpenCut schema type, a command class,
 * an editor state store, an IndexedDB database name or an OPFS path.
 */
import type { AssetResolver, RuntimeAssetLoader } from "./assets";
import type { DiagnosticsPort } from "./diagnostics";
import type { EnvironmentCapabilities } from "./environment";
import type { ExportProvider } from "./export-provider";
import type { IdGenerator } from "./id-generator";
import type { ProjectStore } from "./project-store";
import type { RuntimeResourceHost } from "./runtime-resources";

export type {
	AssetRef,
	AssetResolver,
	RuntimeAssetLoader,
} from "./assets";
export type {
	DiagnosticsPort,
	LogLevel,
	LogRecord,
	SessionDiagnostics,
	SessionEvent,
} from "./diagnostics";
export type {
	EnvironmentCapabilities,
	GraphicsBackend,
	GraphicsCapabilityReport,
	GraphicsDeclaration,
	GraphicsReportSource,
	RuntimeGraphicsQuery,
	SessionCapabilities,
} from "./environment";
export {
	deriveGraphicsReport,
	UNIMPLEMENTED_RUNTIME_GRAPHICS,
} from "./environment";
export type {
	ExportOutcome,
	ExportProvider,
	ExportRequest,
} from "./export-provider";
export type { IdGenerator } from "./id-generator";
export type { ProjectId, ResourceId, SessionId, WorkerId } from "./identity";
export type {
	MigrationContext,
	MigrationOutcome,
	MigrationProgress,
	ProjectRecord,
	ProjectStore,
	ProjectSummary,
} from "./project-store";
export type {
	AudioContextHandle,
	AudioContextRequest,
	ObjectUrlHandle,
	RuntimeResourceHost,
	WorkerErrorEvent,
	WorkerHandle,
	WorkerMessageEvent,
	WorkerRequest,
} from "./runtime-resources";

/**
 * `NavigationHost` is **not** a new port.
 *
 * `EditorHostNavigation` already is one, and it is already implemented by both
 * Hosts. Target State §5.5 calls the role `NavigationHost`, so the role table
 * names it — structurally identical, so no Host code changes. Renaming the
 * interface itself would have been a rename for the sake of a table.
 */
export type { EditorHostNavigation as NavigationHost } from "../host/editor-host";

/**
 * The port roles, as one object.
 *
 * This type exists so the surface has a name that can be spoken about, checked
 * and implemented as a unit — it is *composed into* `EditorHost`, not supplied
 * beside it.
 */
export interface EditorHostPorts {
	/** Persistence. Opaque payload plus typed summary; migrations are its own. */
	store: ProjectStore;
	/** Where first-party static assets live. */
	assets: AssetResolver;
	/** How their bytes are obtained. */
	assetLoader: RuntimeAssetLoader;
	/** Workers, audio contexts and object URLs — constructed by the Host. */
	runtimeResources: RuntimeResourceHost;
	/** Export. Semantics are S08's; the role is declared so it is not a surprise. */
	exporter: ExportProvider;
	/** Logging and session events. */
	diagnostics: DiagnosticsPort;
	/** Id generation, for reproducible headless and automation runs. */
	ids: IdGenerator;
	/** What the Host declares about its graphics environment. */
	environment: EnvironmentCapabilities;
}

/** The port role names, for reporting and for the conformance suite. */
export const PORT_ROLES = [
	"store",
	"assets",
	"assetLoader",
	"runtimeResources",
	"exporter",
	"diagnostics",
	"ids",
	"environment",
] as const satisfies readonly (keyof EditorHostPorts)[];

export type PortRole = (typeof PORT_ROLES)[number];

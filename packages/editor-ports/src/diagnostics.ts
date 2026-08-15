/**
 * The logging and diagnostics port.
 *
 * One port rather than two. `Logger` and `Diagnostics` are named separately in
 * Target State §5.5, but a Host implementing them would implement one object;
 * splitting them at the seam would produce exactly the "independently evolving
 * props" shape Slice §3.3 rules out. They are separate *roles* on one port.
 */
import type { MigrationProgress } from "./project-store";
import type { SessionId } from "./identity";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
	readonly level: LogLevel;
	readonly message: string;
	/**
	 * Structured context. `unknown` rather than a schema type: a diagnostics
	 * port that accepted editor types would be a boundary violation, and a Host
	 * only ever renders or forwards this.
	 */
	readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * Things the Host may want to react to rather than merely display.
 *
 * `migration` is here because of a consequence C3 depends on: migration is
 * genuinely live since Track 1's repair, and still silent. `MigrationDialog` can
 * only ever observe a migration once progress stops being process-global — so a
 * session-scoped channel is a *prerequisite* of C3's dialog repair, not a
 * nicety. The dialog's own repair is C3's.
 */
export type SessionEvent =
	| {
			readonly kind: "migration-started";
			/** `null` when the store cannot report its on-disk version yet. */
			readonly from: number | null;
			readonly to: number;
	  }
	| { readonly kind: "migration-progress"; readonly progress: MigrationProgress }
	| {
			readonly kind: "migration-finished";
			/** Taken from the store's own outcome, which is authoritative. */
			readonly from: number | null;
			readonly to: number;
			readonly recordsMigrated: number;
	  }
	| {
			readonly kind: "migration-failed";
			readonly from: number | null;
			readonly to: number;
			readonly reason: string;
	  };

export interface DiagnosticsPort {
	log(args: { record: LogRecord }): void;
	/**
	 * Report a session-scoped event.
	 *
	 * `sessionId` is on the call rather than on the port so that one Host-supplied
	 * diagnostics implementation serves every session — two sessions sharing a
	 * Host must remain distinguishable in its output.
	 */
	event(args: { sessionId: SessionId; event: SessionEvent }): void;
}

/** The session's own view of the same channel, with its identity already bound. */
export interface SessionDiagnostics {
	log(args: { record: LogRecord }): void;
	event(args: { event: SessionEvent }): void;
	/** Observe events for this session. Used by surfaces; C3 attaches the dialog. */
	subscribe(listener: (event: SessionEvent) => void): () => void;
}

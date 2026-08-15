/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The session transaction facade satisfies the vector target structurally, and the stored commitment is parsed back from its own serialization. */
/**
 * Driver 3 — the Agent scenario against the real session transaction facade
 * (design D6.3, D7).
 *
 * This module is plain async code, not React: the shared evidence harness calls
 * it from an effect and renders only its ledger. It drives
 * `editorForSession(session).transactions` — the same canonical facade T3 routes
 * UI commits through — over whichever durable project store the Host composed,
 * and it opens no sibling engine of its own.
 *
 * Durability is proven across a genuine page reload. The apply phase records
 * what it committed (revision and every created entity, read back from the
 * target) into `localStorage`; the reopen phase runs after `page.reload()` in a
 * brand-new document, opens a fresh session over the same store, and asserts
 * against those observed values. The stale-reopen control works by editing that
 * stored commitment, so the control needs no branch inside this module.
 */
import {
	captureAgentCommitment,
	runAgentScenario,
	verifyAgentReopen,
	type AgentCommitment,
	type AgentLedger,
	type AgentReopenResult,
	type VectorTarget,
} from "@opencut/editor-contracts/vectors";
import type { EditorHost } from "@opencut/editor-ports/host";
import { editorForSession } from "../../runtime/session-core-owner";
import { prepareWasmRuntimeProviders } from "../../runtime/wasm-runtime-providers";
import { createEditorSession, type EditorSession } from "../../session";

export const AGENT_COMMITMENT_STORAGE_KEY = "t4-agent-evidence-commitment";

export type AgentEvidencePhase = "apply" | "reopen";

export interface AgentEvidenceOutcome {
	readonly schema: "t4-agent-evidence-run-v1";
	readonly host: string;
	readonly buildMarker: string;
	readonly phase: AgentEvidencePhase;
	readonly projectId: string | null;
	readonly ledger: AgentLedger | null;
	readonly reopen: AgentReopenResult | null;
	/**
	 * Asset catalog entries the scenario created. Metadata only: no attachment
	 * bytes are written or claimed to commit with the project record.
	 */
	readonly assetMetadata: readonly Readonly<Record<string, unknown>>[];
	readonly attachmentBytesClaimed: false;
	readonly error: string | null;
}

export interface AgentEvidenceRun {
	readonly outcome: AgentEvidenceOutcome;
	readonly dispose: () => Promise<void>;
}

export interface RunAgentEvidenceArgs {
	readonly hostName: string;
	readonly buildMarker: string;
	readonly phase: AgentEvidencePhase;
	readonly createHost: (args: {
		readonly projectId: string;
		readonly onProjectReplaced: (projectId: string) => void;
	}) => EditorHost;
}

function readStoredCommitment(): AgentCommitment | null {
	try {
		const raw = window.localStorage.getItem(AGENT_COMMITMENT_STORAGE_KEY);
		return raw === null ? null : (JSON.parse(raw) as AgentCommitment);
	} catch {
		return null;
	}
}

function writeStoredCommitment(commitment: AgentCommitment): void {
	window.localStorage.setItem(
		AGENT_COMMITMENT_STORAGE_KEY,
		JSON.stringify(commitment),
	);
}

async function openSession(args: RunAgentEvidenceArgs): Promise<{
	readonly session: EditorSession;
	readonly dispose: () => Promise<void>;
}> {
	const host = args.createHost({
		projectId: "t4-agent-evidence",
		onProjectReplaced: () => {},
	});
	const runtime = await prepareWasmRuntimeProviders();
	try {
		const session = await createEditorSession({
			host,
			runtimeGraphics: runtime.runtimeGraphics,
			runtimeGpu: runtime.runtimeGpu,
		});
		return {
			session,
			dispose: async () => {
				await session.dispose().catch(() => {});
				await Promise.resolve(runtime.dispose()).catch(() => {});
			},
		};
	} catch (error) {
		await Promise.resolve(runtime.dispose()).catch(() => {});
		throw error;
	}
}

export async function runAgentEvidence(
	args: RunAgentEvidenceArgs,
): Promise<AgentEvidenceRun> {
	const opened = await openSession(args);
	const editor = editorForSession(opened.session);
	// The donor autosave timer would otherwise race the transaction engine for
	// the same record. Pausing it is a public call and changes no Host wiring.
	editor.save.pause();

	const base = {
		schema: "t4-agent-evidence-run-v1",
		host: args.hostName,
		buildMarker: args.buildMarker,
		phase: args.phase,
		attachmentBytesClaimed: false,
	} as const;

	try {
		if (args.phase === "reopen") {
			const commitment = readStoredCommitment();
			if (!commitment) {
				return {
					outcome: {
						...base,
						projectId: null,
						ledger: null,
						reopen: null,
						assetMetadata: [],
						error: "the apply phase left no commitment to reopen against",
					},
					dispose: opened.dispose,
				};
			}
			await editor.transactions.open({
				projectId: commitment.projectId,
				assets: [],
			});
			const target = editor.transactions as unknown as VectorTarget;
			const reopen = await verifyAgentReopen({ target, commitment });
			return {
				outcome: {
					...base,
					projectId: commitment.projectId,
					ledger: null,
					reopen,
					assetMetadata: commitment.assets,
					error: null,
				},
				dispose: opened.dispose,
			};
		}

		const projectId = await editor.project.createNewProject({
			name: "T4 agent evidence",
		});
		const target = editor.transactions as unknown as VectorTarget;

		// One record publication per durable commit: the router adopts the
		// committed record only when the engine actually saved one.
		let durableSaves = 0;
		const unsubscribe = editor.persistence.subscribeProjectRecords((record) => {
			if (record.id === projectId) durableSaves += 1;
		});
		let ledger: AgentLedger;
		try {
			ledger = await runAgentScenario({
				target,
				driver: "browser/session-transactions",
				host: args.hostName,
				buildMarker: args.buildMarker,
				durableSaves: () => durableSaves,
			});
		} finally {
			unsubscribe();
		}

		const commitment = ledger.commitment ?? (await captureAgentCommitment(target));
		writeStoredCommitment(commitment);
		return {
			outcome: {
				...base,
				projectId: commitment.projectId,
				ledger,
				reopen: null,
				assetMetadata: commitment.assets,
				error: null,
			},
			dispose: opened.dispose,
		};
	} catch (error) {
		return {
			outcome: {
				...base,
				projectId: null,
				ledger: null,
				reopen: null,
				assetMetadata: [],
				error: error instanceof Error ? error.message : String(error),
			},
			dispose: opened.dispose,
		};
	}
}

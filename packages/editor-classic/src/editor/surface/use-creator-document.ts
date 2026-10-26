import { useEffect, useRef, useState } from "react";
import type { CreatorDocument, CreatorWorkspaceBridge, CreatorWorkspaceSnapshot } from "./creator-workspace-types";

/** A document is pinned by its own revision, not by unrelated production updates. */
export function useCreatorDocument(
	source: CreatorDocument,
	read: CreatorWorkspaceBridge["readDocument"] | undefined,
	snapshot: CreatorWorkspaceSnapshot | undefined,
) {
	const key = JSON.stringify([
		snapshot?.projectId,
		snapshot?.scopeRevision?.split(":").slice(1).join(":"),
		source.id,
		source.revision,
		source.contentState,
		Boolean(read),
	]);
	const latest = useRef({ source, read, snapshot });
	latest.current = { source, read, snapshot };
	const [result, setResult] = useState<{ key: string; document?: CreatorDocument; error?: string }>();
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let active = true;
		const current = latest.current;
		if (current.source.contentState !== "unloaded") return;
		setResult(undefined);
		void Promise.resolve().then(() => {
			if (!current.read || !current.snapshot) throw new Error("Document loading is unavailable");
			return current.read({ document: current.source, snapshot: current.snapshot });
		}).then((document) => {
			if (active) setResult({ key, document });
		}).catch((error: unknown) => {
			if (active) setResult({ key, error: error instanceof Error ? error.message : "Document loading failed" });
		});
		return () => { active = false; };
	}, [key, attempt]);
	return {
		document: source.contentState === "unloaded" && result?.key === key ? result.document ?? source : source,
		error: result?.key === key ? result.error : undefined,
		retry: () => setAttempt((value) => value + 1),
	};
}

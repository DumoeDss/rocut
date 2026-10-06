import { useCallback, useRef, useState } from "react";
import type { AnyBaseNode } from "../services/renderer/nodes/base-node";
import { MotionTextNode } from "../services/renderer/nodes/motion-text-node";
import type { MotionTextRenderDiagnostic } from "../services/renderer/motion-text/types";

export interface PreviewResourceIssue {
	readonly sequenceId: string;
	readonly diagnostic: MotionTextRenderDiagnostic;
}

const EMPTY_ISSUES: readonly PreviewResourceIssue[] = [];

// Read already-resolved nodes: no new font loads, coverage scans or domain rules.
export function collectPreviewResourceIssues(
	tree: AnyBaseNode,
): PreviewResourceIssue[] {
	const issues: PreviewResourceIssue[] = [];
	const seen = new Set<string>();
	const visit = (node: AnyBaseNode) => {
		if (node instanceof MotionTextNode) {
			for (const diagnostic of node.diagnostics) {
				const sequenceId = node.params.sequence.id;
				const key = JSON.stringify([sequenceId, diagnostic]);
				if (seen.has(key)) continue;
				seen.add(key);
				issues.push({
					sequenceId,
					diagnostic: {
						...diagnostic,
						codePoints: diagnostic.codePoints?.slice(),
					},
				});
			}
		}
		for (const child of node.children) visit(child);
	};
	visit(tree);
	return issues;
}

interface ResourceSnapshot {
	readonly tree: AnyBaseNode;
	readonly key: string;
	readonly issues: readonly PreviewResourceIssue[];
}

export function usePreviewResourceIssues(tree: AnyBaseNode | null) {
	const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null);
	const latest = useRef<ResourceSnapshot | null>(null);
	const publish = useCallback((renderedTree: AnyBaseNode) => {
		const issues = collectPreviewResourceIssues(renderedTree);
		if (issues.length === 0) {
			if (latest.current === null) return;
			latest.current = null;
			setSnapshot(null);
			return;
		}
		const key = JSON.stringify(issues);
		if (latest.current?.tree === renderedTree && latest.current.key === key)
			return;
		latest.current = { tree: renderedTree, key, issues };
		setSnapshot(latest.current);
	}, []);
	// A late completion for a previous project/revision must never label this one.
	return {
		issues: snapshot?.tree === tree ? snapshot.issues : EMPTY_ISSUES,
		publish,
	};
}

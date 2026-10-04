import { evaluateClipTransitions } from "opencut-wasm";
import { roundMediaTime } from "../../wasm";
import type { AnyBaseNode } from "./nodes/base-node";
import { VideoNode } from "./nodes/video-node";
import { ImageNode } from "./nodes/image-node";
import {
	TransitionTrackNode,
	type ResolvedTransitionTrackItem,
} from "./nodes/transition-track-node";
import type { ResolveContext, TransitionBranchSample } from "./resolve-context";
import { pictureClipId } from "./transition-track";

type Resolver = (args: {
	node: AnyBaseNode;
	context: ResolveContext;
}) => Promise<void>;

export async function resolveTransitionTrack({
	node,
	context,
	resolveNode,
}: {
	node: TransitionTrackNode;
	context: ResolveContext;
	resolveNode: Resolver;
}): Promise<void> {
	node.resolved = null;
	if (!context.frameRate)
		throw new Error("Clip transitions require the renderer project frame rate");
	const graph = evaluateClipTransitions({
		clips: node.params.clips,
		links: node.params.links,
		frameRate: context.frameRate,
		playhead: roundMediaTime({ time: context.time }),
	});
	if (graph.rejected.length)
		throw new Error(
			"Invalid render transition: " + JSON.stringify(graph.rejected),
		);
	const pairs = new Map<
		string,
		Extract<ResolvedTransitionTrackItem, { type: "transition" }>
	>();
	const jobs: Array<() => Promise<void>> = [];
	for (const entry of graph.accepted) {
		const sample = entry.sample;
		if (!sample) continue;
		const link = node.params.links[entry.linkIndex];
		// A hidden endpoint disables the visual relation, not its persisted data.
		if (
			!node.params.visibleClipIds.has(link.outgoingClipId) ||
			!node.params.visibleClipIds.has(link.incomingClipId)
		)
			continue;
		const outgoing = node.children.filter(
			(child) => pictureClipId(child) === link.outgoingClipId,
		);
		const incoming = node.children.filter(
			(child) => pictureClipId(child) === link.incomingClipId,
		);
		for (const branch of [outgoing, incoming])
			if (
				!branch.some(
					(child) => child instanceof VideoNode || child instanceof ImageNode,
				)
			)
				throw new Error("Transition picture resource is missing");
		const pair = {
			type: "transition" as const,
			outgoing,
			incoming,
			progress: sample.progress,
			linkIndex: entry.linkIndex,
		};
		pairs.set(link.outgoingClipId, pair);
		pairs.set(link.incomingClipId, pair);
		const sampleContext = { ...context, time: sample.time };
		jobs.push(() =>
			resolveBranch({
				children: outgoing,
				context: sampleContext,
				resolveNode,
				sample: {
					localTime: sample.outgoingLocalTime,
					sourceTime: sample.outgoingSource,
				},
			}),
		);
		jobs.push(() =>
			resolveBranch({
				children: incoming,
				context: sampleContext,
				resolveNode,
				sample: {
					localTime: sample.incomingLocalTime,
					sourceTime: sample.incomingSource,
				},
			}),
		);
	}
	const result: ResolvedTransitionTrackItem[] = [];
	const emitted = new Set<number>();
	for (const [index, child] of node.children.entries()) {
		const id = pictureClipId(child);
		const pair = id ? pairs.get(id) : undefined;
		if (pair) {
			if (!emitted.has(pair.linkIndex)) {
				emitted.add(pair.linkIndex);
				result.push(pair);
			}
		} else {
			result.push({ type: "node", node: child, index });
			jobs.push(() => resolveNode({ node: child, context }));
		}
	}
	// Drain the whole frame before propagating a failure, so a rejected branch
	// cannot leave older node writes racing a subsequent render of this tree.
	const settled = await Promise.allSettled(jobs.map((run) => run()));
	for (const entry of settled)
		if (entry.status === "rejected") throw entry.reason;
	node.resolved = result;
}

async function resolveBranch({
	children,
	context,
	sample,
	resolveNode,
}: {
	children: AnyBaseNode[];
	context: ResolveContext;
	sample: TransitionBranchSample;
	resolveNode: Resolver;
}): Promise<void> {
	const resolved = await Promise.allSettled(
		children.map((node) =>
			resolveNode({ node, context: { ...context, sample } }),
		),
	);
	for (const entry of resolved)
		if (entry.status === "rejected") throw entry.reason;
	if (children.some((node) => node.resolved === null))
		throw new Error("Transition source frame is unavailable");
}

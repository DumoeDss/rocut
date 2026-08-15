"use client";

import { useCallback, useEffect, useState } from "react";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "../../../components/ui/dialog";

import { useSurfaceDragCoordinator } from "./surface-drag-coordinator";
import { useSurfacePortalOwner } from "./surface-portal";

function isEvidenceRoute() {
	return (
		typeof window !== "undefined" &&
		/(?:surface-evidence(?:\.html)?)(?:[?#]|$)/.test(window.location.href)
	);
}

function DeterministicFailure(): never {
	throw new Error("R2 deterministic render failure");
}

type DragTally = { starts: number; moves: number; finishes: number; cancels: number };

/**
 * Drag tallies that outlive the component.
 *
 * The in-component `useState` counters below are destroyed when the Surface
 * unmounts, and `SurfaceDragProvider` memoises a fresh coordinator on remount —
 * so a post-unmount assertion that reads the rendered `data-finishes` after a
 * remount reads 0 whether or not a stale document event actually fired. That
 * makes the "unmount cancelled stale continuation" claim unfalsifiable.
 *
 * This module-scoped tally survives unmount, so a `finish` delivered to a
 * retired registration is observable. It is evidence-route-only state and is
 * never read by the product.
 */
declare global {
	interface Window {
		__r2SurfaceDragTallies?: Record<string, DragTally>;
	}
}

const dragTallies = new Map<string, DragTally>();

function tallyFor(namespace: string): DragTally {
	const existing = dragTallies.get(namespace);
	if (existing) return existing;
	const created = { starts: 0, moves: 0, finishes: 0, cancels: 0 };
	dragTallies.set(namespace, created);
	return created;
}

function recordDrag({
	namespace,
	field,
}: {
	namespace: string;
	field: keyof DragTally;
}) {
	const tally = tallyFor(namespace);
	tally[field] += 1;
	if (typeof window !== "undefined") {
		window.__r2SurfaceDragTallies = Object.fromEntries(dragTallies);
	}
}

export function SurfaceEvidenceSeams({ namespace }: { namespace: string }) {
	const coordinator = useSurfaceDragCoordinator();
	const portalOwner = useSurfacePortalOwner();
	const [fail, setFail] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [drag, setDrag] = useState({
		starts: 0,
		moves: 0,
		finishes: 0,
		cancels: 0,
	});
	const startDrag = useCallback(() => {
		recordDrag({ namespace, field: "starts" });
		setDrag((current) => ({ ...current, starts: current.starts + 1 }));
		coordinator.start({
			kind: "mouse",
			move: () => {
				recordDrag({ namespace, field: "moves" });
				setDrag((current) => ({ ...current, moves: current.moves + 1 }));
			},
			finish: () => {
				recordDrag({ namespace, field: "finishes" });
				setDrag((current) => ({
					...current,
					finishes: current.finishes + 1,
				}));
			},
			cancel: () => {
				recordDrag({ namespace, field: "cancels" });
				setDrag((current) => ({
					...current,
					cancels: current.cancels + 1,
				}));
			},
		});
	}, [coordinator, namespace]);

	useEffect(() => {
		if (!isEvidenceRoute()) return;
		const eventName = `r2:start-drag:${namespace}`;
		window.addEventListener(eventName, startDrag);
		return () => window.removeEventListener(eventName, startDrag);
	}, [namespace, startDrag]);

	if (!isEvidenceRoute()) return null;
	if (fail) return <DeterministicFailure />;

	return (
		<div
			data-testid={`r2-evidence-seams-${namespace}`}
			className="absolute bottom-2 left-2 z-[300] flex max-w-52 flex-wrap gap-1 rounded bg-background p-1 text-foreground"
		>
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogTrigger asChild>
					<button
						data-testid={`r2-overlay-trigger-${namespace}`}
						type="button"
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === " ")
								setDialogOpen(true);
						}}
					>
						Open Surface evidence dialog
					</button>
				</DialogTrigger>
				<DialogContent
					data-testid={`r2-owned-dialog-${namespace}`}
					aria-describedby={undefined}
				>
					<DialogTitle>Surface evidence dialog</DialogTitle>
					<DialogDescription className="text-popover-foreground">
						Representative content owned by this Surface.
					</DialogDescription>
					<button
						data-testid={`r2-dialog-focus-${namespace}`}
						type="button"
						className="text-popover-foreground"
					>
						Dialog focus target
					</button>
				</DialogContent>
			</Dialog>
			<button
				data-testid={`r2-fail-render-${namespace}`}
				type="button"
				onClick={() => setFail(true)}
			>
				Inject descendant render failure
			</button>
			<button
				data-testid={`r2-drag-start-${namespace}`}
				type="button"
				onKeyDown={(event) => {
					if (event.key === "Enter") startDrag();
				}}
			>
				Start private drag evidence
			</button>
			<output
				data-testid={`r2-drag-result-${namespace}`}
				data-moves={drag.moves}
				data-finishes={drag.finishes}
				data-cancels={drag.cancels}
				data-listeners={coordinator.inspect().listenerCount}
			>
				{JSON.stringify({ ...drag, ...coordinator.inspect() })}
			</output>
			<output
				data-testid={`r2-portal-result-${namespace}`}
				data-owner-ready={portalOwner ? "true" : "false"}
			>
				{portalOwner?.getAttribute("data-editor-surface") ?? "missing"}
			</output>
		</div>
	);
}

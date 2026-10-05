"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftReviewPort } from "@opencut/editor-ports/host";
import {
	createValidatedDraftReviewPort,
	type DraftReviewDocument,
	type DraftReviewItem,
} from "@opencut/editor-contracts/draft";
import { useEditorInstance } from "../../editor/use-editor";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "../ui/dialog";
import { DraftChanges } from "./draft-review-changes";

export function DraftReviewDialog({
	port,
	open,
	onOpenChange,
	onCloseAutoFocus,
}: {
	port: DraftReviewPort;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCloseAutoFocus: (event: Event) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				onCloseAutoFocus={onCloseAutoFocus}
				className="flex max-h-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden"
			>
				<header className="shrink-0 border-b p-5 pr-14">
					<DialogTitle>Review agent changes</DialogTitle>
					<DialogDescription className="mt-2">
						Proposals do not change your project until you approve them.
					</DialogDescription>
				</header>
				{open && <DraftReviewBody port={port} />}
			</DialogContent>
		</Dialog>
	);
}

function DraftReviewBody({ port: transport }: { port: DraftReviewPort }) {
	const port = useMemo(
		() => createValidatedDraftReviewPort(transport),
		[transport],
	);
	const editor = useEditorInstance();
	const [items, setItems] = useState<readonly DraftReviewItem[]>([]);
	const [review, setReview] = useState<DraftReviewDocument | null>(null);
	const [busy, setBusy] = useState(true);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const generation = useRef<object | null>(null);
	const locked = useRef(false);
	const mounted = useRef(true);
	const activeProject = editor.project.getActiveOrNull()?.metadata.id;
	const projectId = useRef(activeProject);
	const ensureProject = useCallback(() => {
		if (
			!projectId.current ||
			editor.project.getActiveOrNull()?.metadata.id !== projectId.current
		) {
			throw new Error(
				"The project changed. Close this review and reopen it for the current project.",
			);
		}
	}, [editor]);
	const perform = useCallback(
		async (operation: (isCurrent: () => boolean) => Promise<void>) => {
			if (locked.current) return;
			locked.current = true;
			const request = {};
			generation.current = request;
			const isCurrent = () => mounted.current && request === generation.current;
			setBusy(true);
			setError("");
			try {
				ensureProject();
				await operation(isCurrent);
			} catch (cause) {
				if (mounted.current && request === generation.current) {
					setError(
						cause instanceof Error
							? cause.message
							: "Unable to read this proposal. Try refreshing the list.",
					);
				}
			} finally {
				if (request === generation.current) locked.current = false;
				if (mounted.current && request === generation.current) setBusy(false);
			}
		},
		[ensureProject],
	);
	const refresh = useCallback(
		() =>
			perform(async (isCurrent) => {
				// Viewing a proposal must not force a save or change playback state.
				if (editor.save.getIsDirty()) await editor.save.flush();
				ensureProject();
				const drafts = await port.list();
				if (!isCurrent()) return;
				setItems(
					drafts.filter(
						(draft) =>
							draft.approvalMode === "manual" &&
							(draft.state === "editing" || draft.state === "conflicted"),
					),
				);
				setReview(null);
			}),
		[editor, ensureProject, perform, port],
	);
	useEffect(() => {
		mounted.current = true;
		locked.current = false;
		void refresh();
		return () => {
			mounted.current = false;
			generation.current = null;
		};
	}, [refresh]);
	const readReview = (id: string) =>
		perform(async (isCurrent) => {
			setReview(null);
			setNotice("");
			if (editor.save.getIsDirty()) await editor.save.flush();
			ensureProject();
			const next = await port.read(id);
			if (isCurrent()) setReview(next);
		});
	const decide = (decision: "approve" | "reject") => {
		if (!review) return;
		const reviewed = review;
		void perform(async (isCurrent) => {
			// Disable repeat decisions even if the request outcome is uncertain.
			setReview(null);
			if (editor.save.getIsDirty()) await editor.save.flush();
			ensureProject();
			if (!isCurrent()) return;
			await port.decide({
				id: reviewed.snapshot.id,
				token: reviewed.token,
				decision,
			});
			if (!isCurrent()) return;
			setNotice(
				decision === "approve"
					? "Changes approved and saved to the project."
					: "Proposal rejected. Your project is unchanged.",
			);
			setItems((previous) =>
				previous.filter((item) => item.id !== reviewed.snapshot.id),
			);
		});
	};
	const canApprove =
		review?.snapshot.state === "editing" &&
		review.snapshot.acceptedOperationCount > 0;
	return (
		<>
			<div
				className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5"
				aria-busy={busy}
				data-testid="draft-review-body"
			>
				{error && (
					<p
						role="alert"
						className="rounded border border-destructive p-3 text-sm"
					>
						{error}
					</p>
				)}
				{notice && (
					<p role="status" className="rounded border p-3 text-sm">
						{notice}
					</p>
				)}
				{busy && (
					<p role="status" className="text-sm text-muted-foreground">
						Loading or saving proposal…
					</p>
				)}
				{review ? (
					<>
						<div className="space-y-1 text-sm">
							<h3 className="font-medium">
								{review.snapshot.acceptedOperationCount} proposed{" "}
								{review.snapshot.acceptedOperationCount === 1
									? "operation"
									: "operations"}
							</h3>
							<p className="text-xs text-muted-foreground break-all">
								Draft {review.snapshot.id} · Base revision{" "}
								{review.snapshot.baseRevision} · {review.snapshot.state}
							</p>
							<p className="text-muted-foreground">
								{[
									...new Set(review.review.entries.map((entry) => entry.kind)),
								].join(", ")}
							</p>
						</div>
						<DraftChanges
							before={review.snapshot.base}
							after={review.snapshot.working}
						/>
					</>
				) : (
					!busy && (
						<>
							{items.length === 0 && (
								<p className="text-sm text-muted-foreground">
									No proposals are waiting for review. Ask the agent to prepare
									a manual draft, then refresh this list.
								</p>
							)}
							<ul className="divide-y">
								{items.map((item) => (
									<li
										key={item.id}
										className="flex min-w-0 items-center gap-3 py-3"
									>
										<div className="min-w-0 flex-1 text-sm">
											<p className="font-medium">
												{item.acceptedOperationCount} proposed{" "}
												{item.acceptedOperationCount === 1
													? "operation"
													: "operations"}
											</p>
											<p className="break-all text-xs text-muted-foreground">
												{item.id}
											</p>
											<p className="text-xs text-muted-foreground">
												{item.state} · Base revision {item.baseRevision}
											</p>
										</div>
										<Button
											size="sm"
											variant="outline"
											aria-label={"Review draft " + item.id}
											onClick={() => void readReview(item.id)}
										>
											Review
										</Button>
									</li>
								))}
							</ul>
						</>
					)
				)}
			</div>
			<footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t p-4">
				<Button variant="ghost" disabled={busy} onClick={() => void refresh()}>
					Refresh proposals
				</Button>
				{review && (
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							disabled={busy || review.snapshot.state !== "editing"}
							onClick={() => decide("reject")}
						>
							Reject proposal
						</Button>
						<Button
							disabled={busy || !canApprove}
							onClick={() => decide("approve")}
						>
							Approve changes
						</Button>
					</div>
				)}
			</footer>
		</>
	);
}

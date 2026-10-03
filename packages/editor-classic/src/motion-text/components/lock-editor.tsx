"use client";

import type {
	MotionTextCue,
	MotionTextLock,
	MotionTextPresetGroup,
	MotionTextSequence,
} from "@opencut/editor-contracts";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { useEditorInstance } from "../../editor/use-editor";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import { cn } from "../../utils/ui";
import {
	mutateMotionTextSequence,
	type MotionTextSequenceBuildDiagnostic,
} from "../../wasm";
import {
	hasMotionTextLock,
	MOTION_TEXT_LOCKABLE_PRESET_GROUPS,
} from "../lock-state";

const PRESET_GROUP_LABELS: Readonly<Record<MotionTextPresetGroup, string>> = {
	style: "Style",
	layout: "Layout",
	enter: "Enter",
	hold: "Hold",
	exit: "Exit",
	decor: "Decor",
	treat: "Treatment",
	bg: "Background",
	cam: "Camera",
	fx: "Effects",
	trans: "Transition",
};

function diagnosticMessage(
	diagnostics: readonly MotionTextSequenceBuildDiagnostic[],
): string {
	return (
		diagnostics.find((entry) => entry.severity === "error")?.message ??
		diagnostics[0]?.message ??
		"The motion-text lock could not be updated."
	);
}

function LockToggle({
	active,
	children,
	disabled,
	busy,
	onClick,
}: {
	readonly active: boolean;
	readonly children: ReactNode;
	readonly disabled: boolean;
	readonly busy: boolean;
	readonly onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			aria-disabled={disabled || busy}
			aria-busy={busy}
			disabled={disabled}
			onClick={() => { if (!busy) onClick(); }}
			className={cn(
				"focus-visible:ring-ring rounded-full border px-2 py-1 text-[11px] outline-none focus-visible:ring-1 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-busy:cursor-wait",
				active
					? "bg-foreground text-background border-foreground"
					: "text-muted-foreground border-border",
			)}
		>
			{children}
		</button>
	);
}

export function MotionTextLockEditor({
	sequence,
	cue,
	onMessage,
}: {
	readonly sequence: MotionTextSequence;
	readonly cue: MotionTextCue;
	readonly onMessage: (message: string | null) => void;
}) {
	const editor = useEditorInstance();
	const [pendingLock, setPendingLock] = useState<string | null>(null);
	const pendingRef = useRef(false);
	const fullCueLocked = hasMotionTextLock({
		cue,
		scope: "cue",
		key: "all",
	});
	const cuts = useMemo(
		() =>
			(sequence.resolvedPlan?.cuts ?? [])
				.filter((cut) => cut.cueId === cue.id)
				.toSorted(
					(left, right) =>
						left.startTime - right.startTime || left.id.localeCompare(right.id),
				),
		[cue.id, sequence.resolvedPlan?.cuts],
	);
	const cutIds = useMemo(
		() => new Set<string>(cuts.map((cut) => cut.id)),
		[cuts],
	);
	const staleCutLocks = cue.locks.filter(
		(lock) => lock.scope === "cut" && !cutIds.has(lock.key),
	);
	const parameterKeys = useMemo(() => {
		const values = new Set<string>();
		for (const cut of cuts) {
			for (const key of Object.keys(cut.parameters)) values.add(key);
		}
		for (const lock of cue.locks) {
			if (lock.scope === "parameter") values.add(lock.key);
		}
		return [...values].sort((left, right) => left.localeCompare(right));
	}, [cue.locks, cuts]);

	const setLock = async ({
		scope,
		key,
	}: Pick<MotionTextLock, "scope" | "key">) => {
		const identity = `${scope}:${key}`;
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPendingLock(identity);
		onMessage(null);
		try {
			const locked = !hasMotionTextLock({ cue, scope, key });
			const result = mutateMotionTextSequence({
				sequence,
				mutation: {
					kind: "set-cue-lock",
					cueId: cue.id,
					scope,
					key,
					locked,
				},
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			});
			if (!result.sequence) {
				onMessage(diagnosticMessage(result.diagnostics));
				return;
			}
			await editor.project.updateMotionTextSequence({
				sequence: result.sequence,
			});
			onMessage(
				`${locked ? "Lock" : "Unlock"} saved as one project transaction.`,
			);
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "The motion-text lock could not be updated.",
			);
		} finally {
			pendingRef.current = false;
			setPendingLock(null);
		}
	};

	const toggle = ({ scope, key }: Pick<MotionTextLock, "scope" | "key">) => {
		void setLock({ scope, key });
	};
	const lockDisabled = ({
		scope,
		key,
	}: Pick<MotionTextLock, "scope" | "key">): boolean => {
		return (
			fullCueLocked &&
			!hasMotionTextLock({ cue, scope, key }) &&
			!(scope === "cue" && key === "all")
		);
	};

	return (
		<section
			className="space-y-3 border-b px-3 py-3"
			aria-labelledby={`motion-text-locks-${cue.id}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<h4
						id={`motion-text-locks-${cue.id}`}
						className="text-xs font-medium"
					>
						Locks &amp; inheritance
					</h4>
					<p className="text-muted-foreground mt-0.5 text-[11px] leading-4">
						Locks preserve current resolved values while defaults and variations
						change.
					</p>
				</div>
				<Button
					variant={fullCueLocked ? "secondary" : "outline"}
					size="sm"
					aria-pressed={fullCueLocked}
					aria-disabled={pendingLock !== null}
					aria-busy={pendingLock !== null}
					className="aria-disabled:cursor-wait aria-disabled:opacity-50"
					onClick={() => toggle({ scope: "cue", key: "all" })}
				>
					{fullCueLocked ? "Unlock cue" : "Lock cue"}
				</Button>
			</div>

			<div className="space-y-1.5">
				<p className="text-[11px] font-medium">Field sets</p>
				<div className="flex flex-wrap gap-1.5">
					<LockToggle
						busy={pendingLock !== null}
						active={hasMotionTextLock({
							cue,
							scope: "cue",
							key: "preset",
						})}
						disabled={lockDisabled({ scope: "cue", key: "preset" })}
						onClick={() => toggle({ scope: "cue", key: "preset" })}
					>
						All preset groups
					</LockToggle>
					<LockToggle
						busy={pendingLock !== null}
						active={hasMotionTextLock({
							cue,
							scope: "cue",
							key: "parameters",
						})}
						disabled={lockDisabled({ scope: "cue", key: "parameters" })}
						onClick={() => toggle({ scope: "cue", key: "parameters" })}
					>
						All parameters
					</LockToggle>
				</div>
			</div>

			<div className="space-y-1.5">
				<p className="text-[11px] font-medium">Preset groups</p>
				<div className="flex flex-wrap gap-1.5">
					{MOTION_TEXT_LOCKABLE_PRESET_GROUPS.map((group) => (
						<LockToggle
							key={group}
							busy={pendingLock !== null}
							active={hasMotionTextLock({
								cue,
								scope: "preset-group",
								key: group,
							})}
							disabled={lockDisabled({
								scope: "preset-group",
								key: group,
							})}
							onClick={() => toggle({ scope: "preset-group", key: group })}
						>
							{PRESET_GROUP_LABELS[group]}
						</LockToggle>
					))}
				</div>
			</div>

			{(cuts.length > 0 || staleCutLocks.length > 0) && (
				<div className="space-y-1.5">
					<p className="text-[11px] font-medium">Resolved cuts</p>
					<div className="flex flex-wrap gap-1.5">
						{cuts.map((cut, index) => (
							<LockToggle
								key={cut.id}
								busy={pendingLock !== null}
								active={hasMotionTextLock({
									cue,
									scope: "cut",
									key: cut.id,
								})}
								disabled={lockDisabled({ scope: "cut", key: cut.id })}
								onClick={() => toggle({ scope: "cut", key: cut.id })}
							>
								{index + 1}. {cut.text || "Interlude"}
							</LockToggle>
						))}
						{staleCutLocks.map((lock) => (
							<LockToggle
								key={`stale:${lock.key}`}
								busy={pendingLock !== null}
								active
								disabled={false}
								onClick={() => toggle({ scope: "cut", key: lock.key })}
							>
								Missing cut · remove
							</LockToggle>
						))}
					</div>
				</div>
			)}

			{parameterKeys.length > 0 && (
				<div className="space-y-1.5">
					<p className="text-[11px] font-medium">Parameters</p>
					<div className="flex flex-wrap gap-1.5">
						{parameterKeys.map((key) => (
							<LockToggle
								key={key}
								busy={pendingLock !== null}
								active={hasMotionTextLock({
									cue,
									scope: "parameter",
									key,
								})}
								disabled={lockDisabled({ scope: "parameter", key })}
								onClick={() => toggle({ scope: "parameter", key })}
							>
								{key}
							</LockToggle>
						))}
					</div>
				</div>
			)}
		</section>
	);
}

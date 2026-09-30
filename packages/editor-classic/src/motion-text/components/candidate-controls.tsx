"use client";

import type {
	MotionTextPresetGroup,
	MotionTextSequence,
} from "@opencut/editor-contracts";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { useEditorInstance } from "../../editor/use-editor";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import { cn } from "../../utils/ui";
import {
	createMotionTextVariationCandidate,
	getMotionTextStarterPresetId,
	restyleStarterMotionTextSequence,
	type MotionTextSequenceBuildDiagnostic,
	type MotionTextStarterPresetId,
} from "../../wasm";
import { MOTION_TEXT_STARTER_PRESETS } from "../starter-presets";

const VARIATION_GROUPS = [
	"style",
	"layout",
	"enter",
	"hold",
	"exit",
	"treat",
	"cam",
] as const satisfies readonly MotionTextPresetGroup[];

const VARIATION_GROUP_LABELS: Readonly<
	Record<(typeof VARIATION_GROUPS)[number], string>
> = {
	style: "Style",
	layout: "Layout",
	enter: "Enter",
	hold: "Motion",
	exit: "Exit",
	treat: "Treatment",
	cam: "Camera",
};

type Candidate =
	| {
			readonly kind: "starter";
			readonly baseRevision: number;
			readonly sequence: MotionTextSequence;
			readonly preset: MotionTextStarterPresetId;
	  }
	| {
			readonly kind: "variation";
			readonly baseRevision: number;
			readonly sequence: MotionTextSequence;
			readonly salt: number;
			readonly cueIds: readonly string[];
			readonly groups: readonly MotionTextPresetGroup[];
	  };

function diagnosticMessage(
	diagnostics: readonly MotionTextSequenceBuildDiagnostic[],
): string | null {
	const diagnostic =
		diagnostics.find((entry) => entry.severity === "error") ??
		diagnostics.find((entry) => entry.severity === "warning");
	return diagnostic?.message ?? null;
}

export function MotionTextCandidateControls({
	sequence,
	selectedCueId,
	onMessage,
}: {
	readonly sequence: MotionTextSequence;
	readonly selectedCueId: string | null;
	readonly onMessage: (message: string | null) => void;
}) {
	const editor = useEditorInstance();
	const appliedPreset = getMotionTextStarterPresetId(sequence);
	const [candidate, setCandidate] = useState<Candidate | null>(null);
	const [isApplying, setIsApplying] = useState(false);
	const [variationScope, setVariationScope] = useState<"all" | "selected">(
		"all",
	);
	const [variationGroups, setVariationGroups] =
		useState<readonly MotionTextPresetGroup[]>(VARIATION_GROUPS);
	const activeCandidate =
		candidate?.baseRevision === sequence.revision &&
		candidate.sequence.id === sequence.id
			? candidate
			: null;
	const effectiveVariationScope =
		selectedCueId === null ? "all" : variationScope;
	const candidatePreset =
		activeCandidate?.kind === "starter"
			? activeCandidate.preset
			: appliedPreset;

	useEffect(
		() => () => {
			editor.renderer.clearMotionTextSequencePreview({
				sequenceId: sequence.id,
			});
		},
		[editor, sequence.id],
	);

	const publishCandidate = (nextCandidate: Candidate): boolean => {
		if (
			!editor.renderer.setMotionTextSequencePreview({
				baseRevision: nextCandidate.baseRevision,
				sequence: nextCandidate.sequence,
			})
		) {
			setCandidate(null);
			onMessage("The sequence changed before the preview could be shown.");
			return false;
		}
		setCandidate(nextCandidate);
		onMessage(null);
		return true;
	};

	const cancelCandidate = () => {
		editor.renderer.clearMotionTextSequencePreview({
			sequenceId: sequence.id,
		});
		setCandidate(null);
		onMessage(null);
	};

	const previewStarterPreset = (preset: MotionTextStarterPresetId) => {
		if (preset === appliedPreset) {
			cancelCandidate();
			return;
		}
		try {
			const result = restyleStarterMotionTextSequence({
				sequence,
				starterPreset: preset,
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			});
			if (!result.sequence) {
				onMessage(
					diagnosticMessage(result.diagnostics) ??
						"The selected preset could not be previewed.",
				);
				return;
			}
			publishCandidate({
				kind: "starter",
				baseRevision: sequence.revision,
				sequence: result.sequence,
				preset,
			});
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "The selected preset could not be previewed.",
			);
		}
	};

	const generateVariation = () => {
		const cueIds =
			effectiveVariationScope === "selected" && selectedCueId !== null
				? [selectedCueId]
				: [];
		const salt =
			activeCandidate?.kind === "variation"
				? (activeCandidate.salt + 1) % 0x1_0000_0000
				: 1;
		try {
			const result = createMotionTextVariationCandidate({
				sequence,
				salt,
				cueIds,
				groups: variationGroups,
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			});
			if (
				!result.sequence ||
				result.baseRevision === null ||
				result.candidateRevision === null
			) {
				onMessage(
					diagnosticMessage(result.diagnostics) ??
						"A variation candidate could not be generated.",
				);
				return;
			}
			publishCandidate({
				kind: "variation",
				baseRevision: result.baseRevision,
				sequence: result.sequence,
				salt: result.salt,
				cueIds,
				groups: variationGroups,
			});
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "A variation candidate could not be generated.",
			);
		}
	};

	const applyCandidate = async () => {
		if (!activeCandidate || isApplying) return;
		setIsApplying(true);
		onMessage(null);
		try {
			await editor.project.updateMotionTextSequence({
				sequence: activeCandidate.sequence,
			});
			editor.renderer.clearMotionTextSequencePreview({
				sequenceId: sequence.id,
			});
			setCandidate(null);
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "The preview candidate could not be applied.",
			);
		} finally {
			setIsApplying(false);
		}
	};

	const toggleVariationGroup = (group: MotionTextPresetGroup) => {
		if (activeCandidate?.kind === "variation") cancelCandidate();
		setVariationGroups((current) =>
			current.includes(group)
				? current.filter((candidateGroup) => candidateGroup !== group)
				: [...current, group],
		);
	};

	return (
		<>
			<section className="border-b px-3 py-3">
				<div className="mb-2 flex items-baseline justify-between gap-2">
					<h3 className="text-sm font-medium">Starter style</h3>
					{activeCandidate?.kind === "starter" && (
						<span className="text-caution text-[11px]">Preview only</span>
					)}
				</div>
				<div className="grid grid-cols-2 gap-1.5">
					{MOTION_TEXT_STARTER_PRESETS.map((preset) => (
						<button
							key={preset.id}
							type="button"
							aria-pressed={candidatePreset === preset.id}
							onClick={() => previewStarterPreset(preset.id)}
							className={cn(
								"focus-visible:ring-ring overflow-hidden rounded-sm border text-left outline-none focus-visible:ring-1",
								candidatePreset === preset.id
									? "border-foreground"
									: "border-border",
							)}
						>
							<span
								className={cn(
									"flex h-9 items-center overflow-hidden px-2",
									preset.previewClassName,
								)}
							>
								<span className={preset.textClassName}>
									{preset.previewText}
								</span>
							</span>
							<span className="block truncate px-2 py-1.5 text-[11px] font-medium">
								{preset.name}
							</span>
						</button>
					))}
				</div>
				{appliedPreset === null && (
					<p className="text-caution mt-2 text-xs">
						This sequence uses a style outside the starter set. Choose a starter
						style to replace it.
					</p>
				)}
				<div className="mt-2 flex justify-end gap-2">
					<Button
						variant="ghost"
						size="sm"
						disabled={activeCandidate?.kind !== "starter" || isApplying}
						onClick={cancelCandidate}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						disabled={activeCandidate?.kind !== "starter" || isApplying}
						onClick={() => void applyCandidate()}
					>
						{isApplying ? "Applying…" : "Apply"}
					</Button>
				</div>
			</section>

			<section className="border-b px-3 py-3">
				<div className="mb-2 flex items-baseline justify-between gap-2">
					<h3 className="text-sm font-medium">Variation</h3>
					{activeCandidate?.kind === "variation" && (
						<span className="text-caution text-[11px]">Canvas preview</span>
					)}
				</div>
				<p className="text-muted-foreground mb-2 text-xs leading-4">
					Generate a deterministic candidate. Locked cues and groups stay
					unchanged until you apply it.
				</p>
				<div className="mb-2 flex gap-1.5">
					<Button
						variant={
							effectiveVariationScope === "all" ? "secondary" : "outline"
						}
						size="sm"
						aria-pressed={effectiveVariationScope === "all"}
						onClick={() => setVariationScope("all")}
					>
						All cues
					</Button>
					<Button
						variant={
							effectiveVariationScope === "selected" ? "secondary" : "outline"
						}
						size="sm"
						aria-pressed={effectiveVariationScope === "selected"}
						disabled={selectedCueId === null}
						onClick={() => setVariationScope("selected")}
					>
						Selected cue
					</Button>
				</div>
				<div className="flex flex-wrap gap-1.5" aria-label="Variation groups">
					{VARIATION_GROUPS.map((group) => (
						<button
							key={group}
							type="button"
							aria-pressed={variationGroups.includes(group)}
							onClick={() => toggleVariationGroup(group)}
							className={cn(
								"focus-visible:ring-ring rounded-full border px-2 py-1 text-[11px] outline-none focus-visible:ring-1",
								variationGroups.includes(group)
									? "bg-secondary text-secondary-foreground"
									: "text-muted-foreground",
							)}
						>
							{VARIATION_GROUP_LABELS[group]}
						</button>
					))}
				</div>
				{activeCandidate?.kind === "variation" && (
					<p className="text-muted-foreground mt-2 text-[11px] tabular-nums">
						Candidate r{activeCandidate.sequence.revision} · salt{" "}
						{activeCandidate.salt}
						{activeCandidate.cueIds.length === 1
							? " · selected cue"
							: " · all cues"}
					</p>
				)}
				<div className="mt-2 flex flex-wrap justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={variationGroups.length === 0 || isApplying}
						onClick={generateVariation}
					>
						{activeCandidate?.kind === "variation"
							? "Reroll variation"
							: "Generate variation"}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled={activeCandidate?.kind !== "variation" || isApplying}
						onClick={cancelCandidate}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						disabled={activeCandidate?.kind !== "variation" || isApplying}
						onClick={() => void applyCandidate()}
					>
						{isApplying ? "Applying…" : "Apply variation"}
					</Button>
				</div>
			</section>
		</>
	);
}

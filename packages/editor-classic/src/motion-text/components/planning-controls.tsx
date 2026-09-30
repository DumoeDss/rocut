"use client";

import type {
	MotionTextPlanningControls,
	MotionTextPresetSetControls,
	MotionTextSequence,
} from "@opencut/editor-contracts";
import { useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { useEditorInstance } from "../../editor/use-editor";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import { cn } from "../../utils/ui";
import {
	getMotionTextPlanningControls,
	mutateMotionTextSequence,
	type MotionTextSequenceBuildDiagnostic,
} from "../../wasm";

const PRESET_SETS = [
	"typo",
	"kinetic",
	"horror",
] as const satisfies readonly (keyof MotionTextPresetSetControls)[];

const PRESET_SET_LABELS: Readonly<
	Record<(typeof PRESET_SETS)[number], string>
> = {
	typo: "Typography",
	kinetic: "Kinetic",
	horror: "Horror",
};

function diagnosticMessage(
	diagnostics: readonly MotionTextSequenceBuildDiagnostic[],
): string {
	return (
		diagnostics.find((entry) => entry.severity === "error")?.message ??
		diagnostics[0]?.message ??
		"Planning controls could not be updated."
	);
}

function ToggleButton({
	pressed,
	disabled,
	children,
	onClick,
}: {
	readonly pressed: boolean;
	readonly disabled?: boolean;
	readonly children: ReactNode;
	readonly onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"focus-visible:ring-ring rounded-full border px-2 py-1 text-[11px] outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50",
				pressed
					? "bg-secondary text-secondary-foreground"
					: "text-muted-foreground",
			)}
		>
			{children}
		</button>
	);
}

export function MotionTextPlanningControlsEditor({
	sequence,
	onMessage,
}: {
	readonly sequence: MotionTextSequence;
	readonly onMessage: (message: string | null) => void;
}) {
	const editor = useEditorInstance();
	const controls = getMotionTextPlanningControls(sequence);
	const [isApplying, setIsApplying] = useState(false);

	const apply = async (next: MotionTextPlanningControls) => {
		if (isApplying) return;
		setIsApplying(true);
		onMessage(null);
		try {
			const result = mutateMotionTextSequence({
				sequence,
				mutation: {
					kind: "update-planning-controls",
					controls: next,
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
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "Planning controls could not be updated.",
			);
		} finally {
			setIsApplying(false);
		}
	};

	const togglePresetSet = (presetSet: keyof MotionTextPresetSetControls) => {
		void apply({
			...controls,
			presetSets: {
				...controls.presetSets,
				[presetSet]: !controls.presetSets[presetSet],
			},
		});
	};

	return (
		<section className="border-b px-3 py-3" data-motion-text-planning-controls>
			<div className="mb-2 flex items-baseline justify-between gap-2">
				<h3 className="text-sm font-medium">Planning</h3>
				<span className="text-muted-foreground text-[11px]">JIZURA</span>
			</div>
			<p className="text-muted-foreground mb-2 text-xs leading-4">
				Choose which preset families deterministic variations may use. Explicit
				and locked selections stay intact.
			</p>
			<div className="flex flex-wrap gap-1.5" aria-label="Preset families">
				{PRESET_SETS.map((presetSet) => (
					<ToggleButton
						key={presetSet}
						pressed={controls.presetSets[presetSet]}
						disabled={isApplying}
						onClick={() => togglePresetSet(presetSet)}
					>
						{PRESET_SET_LABELS[presetSet]}
					</ToggleButton>
				))}
			</div>
			<div className="mt-2 grid grid-cols-2 gap-1.5">
				<Button
					variant={controls.unify ? "secondary" : "outline"}
					size="sm"
					aria-pressed={controls.unify}
					disabled={isApplying}
					onClick={() => void apply({ ...controls, unify: !controls.unify })}
				>
					Unified look
				</Button>
				<Button
					variant={controls.centerFree ? "secondary" : "outline"}
					size="sm"
					aria-pressed={controls.centerFree}
					disabled={isApplying}
					onClick={() =>
						void apply({ ...controls, centerFree: !controls.centerFree })
					}
				>
					Keep center clear
				</Button>
			</div>
			<div className="mt-2 flex items-center justify-between gap-2">
				<span className="text-muted-foreground text-xs">Portrait bands</span>
				<div className="flex gap-1.5">
					<ToggleButton
						pressed={controls.centerDirection === "tb"}
						disabled={isApplying || !controls.centerFree}
						onClick={() => void apply({ ...controls, centerDirection: "tb" })}
					>
						Top / bottom
					</ToggleButton>
					<ToggleButton
						pressed={controls.centerDirection === "lr"}
						disabled={isApplying || !controls.centerFree}
						onClick={() => void apply({ ...controls, centerDirection: "lr" })}
					>
						Left / right
					</ToggleButton>
				</div>
			</div>
		</section>
	);
}

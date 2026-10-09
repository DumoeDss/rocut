"use client";

import { useEffect, useId, useMemo, useSyncExternalStore } from "react";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "../../components/section";
import { Button } from "../../components/ui/button";
import { useEditorInstance } from "../../editor/use-editor";
import type { GraphicElement } from "../../timeline";
import {
	getSourceDraft,
	sourceFingerprint,
	sourceReadOnlyReason,
} from "./programmatic-source-draft";
import { ProgrammaticSourceCommand } from "./programmatic-source-command";
import { ProgrammaticSourceFields } from "./programmatic-source-fields";
import { ProgrammaticBuildEditor } from "./programmatic-build-editor";

export function ProgrammaticSourcePanel({
	element,
	trackId,
}: {
	element: GraphicElement;
	trackId: string;
}) {
	const editor = useEditorInstance();
	const source = element.programmatic;
	const projectId = editor.project.getActive().metadata.id;
	const sceneId = editor.scenes.getActiveScene().id;
	if (!source)
		return (
			<p className="text-destructive p-3.5 text-sm" role="alert">
				This clip has no programmatic source.
			</p>
		);
	return (
		<SourceEditor
			key={JSON.stringify([projectId, sceneId, trackId, element.id])}
			source={source}
			projectId={projectId}
			sceneId={sceneId}
			trackId={trackId}
			elementId={element.id}
		/>
	);
}

function SourceEditor({
	source,
	projectId,
	sceneId,
	trackId,
	elementId,
}: {
	source: ProgrammaticSource;
	projectId: string;
	sceneId: string;
	trackId: string;
	elementId: string;
}) {
	const editor = useEditorInstance();
	const id = useId();
	const key = JSON.stringify([projectId, sceneId, trackId, elementId]);
	const draft = useMemo(
		() => getSourceDraft({ owner: editor, key, source }),
		[editor, key, source],
	);
	const state = useSyncExternalStore(
		draft.subscribe,
		draft.getSnapshot,
		draft.getSnapshot,
	);
	useEffect(() => draft.refresh(source), [draft, source]);
	const conflict =
		state.conflict ||
		sourceFingerprint(source) !== sourceFingerprint(state.baseline);
	const readOnly = sourceReadOnlyReason(source);
	const apply = () =>
		draft.apply(async (submitted) => {
			await editor.command.execute({
				command: new ProgrammaticSourceCommand({
					projectId,
					sceneId,
					trackId,
					elementId,
					baseline: submitted.baseline,
					code: submitted.code,
					seed: submitted.seed,
				}),
			});
			return {
				...submitted.baseline,
				code: submitted.code,
				seed: Number(submitted.seed),
			};
		});
	return (
		<Section collapsible sectionKey={`${key}:programmatic-source`}>
			<SectionHeader>
				<SectionTitle>Programmatic source</SectionTitle>
			</SectionHeader>
			<SectionContent className="min-w-0">
				<div className="flex min-w-0 flex-col gap-3 text-sm">
					<SourceMetadata source={source} />
					<ProgrammaticSourceFields
						id={id}
						runtime={source.runtime}
						state={state}
						readOnly={readOnly}
						onEdit={(patch) => draft.edit(patch)}
					/>
					{source.build && source.build.engine !== "three" && (
						<ProgrammaticBuildEditor
							source={source}
							scope={{ projectId, sceneId, trackId, elementId }}
						/>
					)}
					{conflict && state.dirty && (
						<p className="text-destructive text-xs" role="alert">
							The source changed outside this draft. Your edits are retained.
							Discard to load the current source before editing again.
						</p>
					)}
					{state.error && (
						<p className="text-destructive break-words text-xs" role="alert">
							{state.error}
						</p>
					)}
					{(!readOnly || state.dirty) && (
						<>
							<p
								id={`${id}-status`}
								className="text-muted-foreground text-xs"
								role="status"
							>
								{state.pending
									? "Applying source..."
									: state.dirty
										? "Unapplied draft"
										: "Source is up to date"}
							</p>
							<div className="flex justify-end gap-2">
								<Button
									variant="outline"
									size="sm"
									disabled={state.pending || (!state.dirty && !conflict)}
									onClick={() => draft.discard()}
								>
									Discard
								</Button>
								<Button
									size="sm"
									disabled={
										!!readOnly || !state.dirty || state.pending || conflict
									}
									onClick={() => void apply()}
								>
									Apply
								</Button>
							</div>
						</>
					)}
				</div>
			</SectionContent>
		</Section>
	);
}

function SourceMetadata({ source }: { source: ProgrammaticSource }) {
	const rows = [
		["Runtime", source.runtime],
		["Size", `${source.width} x ${source.height}`],
		[
			"Frame rate",
			`${source.frameRate.numerator}/${source.frameRate.denominator} fps`,
		],
		["Duration", `${source.durationFrames} frames`],
		["Resources", String(source.resources?.length ?? 0)],
		[
			"Audio",
			source.audio
				? `Native${source.audio.muted ? " (muted)" : ""}${source.audio.profile ? ` / ${source.audio.profile}` : ""}`
				: "No source soundtrack",
		],
		...(source.documentId ? [["Document", source.documentId]] : []),
		...(source.build
			? [
					["Build", `${source.build.engine} ${source.build.engineVersion}`],
					["Entry", source.build.entryFile],
					["Archived files", String(source.build.inputs.length)],
				]
			: []),
	];
	return (
		<dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
			{rows.map(([label, value]) => (
				<div key={label} className="contents">
					<dt className="text-muted-foreground">{label}</dt>
					<dd className="min-w-0 break-words">{value}</dd>
				</div>
			))}
		</dl>
	);
}

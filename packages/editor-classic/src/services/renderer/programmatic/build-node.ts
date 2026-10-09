import type { GraphicElement } from "../../../timeline";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import {
	buildTransformFromParams,
	readOpacityFromParams,
	readBlendModeFromParams,
} from "../../../rendering";
import { ProgrammaticNode } from "../nodes/programmatic-node";

export function buildProgrammaticNode({
	element,
	programmaticFrames,
}: {
	element: GraphicElement;
	programmaticFrames?: ProgrammaticFrameProvider;
}): ProgrammaticNode {
	if (element.definitionId !== "programmatic" || !element.programmatic) {
		throw new Error(
			`Programmatic clip ${element.id} has mismatched definition/source`,
		);
	}
	return new ProgrammaticNode({
		clipId: element.id,
		source: element.programmatic,
		programmaticFrames,
		duration: element.duration,
		timeOffset: element.startTime,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
		transform: buildTransformFromParams({ params: element.params }),
		animations: element.animations,
		opacity: readOpacityFromParams({ params: element.params }),
		blendMode: readBlendModeFromParams({ params: element.params }),
		effects: element.effects ?? [],
		masks: element.masks ?? [],
	});
}

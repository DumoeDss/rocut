export function inkHostApplyRequest(context, shot, source) {
	return {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Ink Object controlled Three probe",
					canvasWidth: 192,
					canvasHeight: 128,
					frameRate: shot.spec.frameRate,
				},
			},
			{
				kind: "create-track",
				track: {
					id: "ink-track",
					name: "Ink Object",
					kind: "graphic",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: "ink-object",
					trackId: "ink-track",
					startTime: 0,
					duration: 245000,
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "graphic",
						name: "Ink Object",
						definitionId: "programmatic",
						params: {},
						effects: shot.effects,
						programmatic: source,
					},
				},
			},
		],
	};
}

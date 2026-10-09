/** Discovery metadata only. Rust owns manifest/image admission and all budgets. */
export const IMAGE_SEQUENCE_RESOURCE_CAPABILITY = {
	version: 1,
	kind: "imageSequence",
	status: "experimental",
	acceptance: {
		complete: false,
		encodedPixelQuality: "not-accepted",
		installedElectron: "not-verified",
	},
	import: "programmatic/resources/import-image-sequence",
	importInput: {
		id: "logical-resource-id",
		manifestPath: "absolute-manifest-path-contained-in-rootDirectory",
		rootDirectory: "absolute-existing-source-root",
	},
	restoreSource: "programmatic/resources/restore-image-sequence-source",
	restoreSourceInput: {
		resource: "imported-imageSequence-resource-descriptor",
		outputParent: "absolute-existing-directory",
	},
	consumer: {
		engine: "mv-recipe",
		sceneKind: "imageSequence",
		sequence: "declared-source.resources-id",
	},
	genericImport: false,
	closure:
		"complete-frame-and-provenance-attachment-closure; canonical-manifest-published-after-durable-verification",
	mutation:
		"import-prepares-resource; attach-via-editing-transaction; source-restore-does-not-change-project-revision",
	restoreScope:
		"archived-authoring-source-files-and-original-manifest-only; no-rendered-frames",
	limits: "Rust-admitted-manifest-and-image-limits",
	unsupported: [
		"canvas-assets.image",
		"html-resource-image",
		"automatic-blender-render",
		"rendered-frame-restore",
	],
} as const;

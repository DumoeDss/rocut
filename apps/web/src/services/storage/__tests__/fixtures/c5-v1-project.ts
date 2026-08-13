// Local copy of `v1Project` from
// packages/editor-classic/src/services/storage/migrations/__tests__/fixtures/v1.ts, scoped to the
// one export this shell test actually asserts on (`v1ProjectWithMultipleScenes` is unused here and
// deliberately not duplicated). `__tests__` directories are never legitimate declared-entry targets
// — `public-entry-only` / `no-internal-reexport` exist precisely to forbid reaching one from outside
// the package — so this apps/web-owned test cannot import the package's private fixture directly.
// Stage C (task 5.3) finding: keep this in sync by hand if the source fixture's `v1Project` shape
// changes; there is no mechanical link between the two copies.
export const v1Project = {
	id: "project-v1-123",
	version: 1,
	name: "My V1 Project",
	createdAt: "2024-01-15T10:00:00.000Z",
	updatedAt: "2024-01-15T12:00:00.000Z",
	fps: 30,
	canvasSize: { width: 1920, height: 1080 },
	backgroundColor: "#1a1a1a",
	backgroundType: "color",
	currentSceneId: "scene-main",
	bookmarks: [2.0, 4.5, 7.0],
	scenes: [
		{
			id: "scene-main",
			name: "Main scene",
			isMain: true,
			tracks: [],
			bookmarks: [],
			createdAt: "2024-01-15T10:00:00.000Z",
			updatedAt: "2024-01-15T12:00:00.000Z",
		},
	],
};

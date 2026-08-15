import type { EditorCore } from "../../editor-classic/src/core";

export interface ProjectStore {
	core(): EditorCore;
}

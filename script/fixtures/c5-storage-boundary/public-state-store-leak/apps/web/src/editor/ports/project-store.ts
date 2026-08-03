import type { EditorCore } from "@/core";

export interface ProjectStore {
	core(): EditorCore;
}

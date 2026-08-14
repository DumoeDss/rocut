import type { BrowserProjectStore } from "../../editor-classic/src/services/storage/browser-project-store";

export interface ProjectStore {
	implementation(): BrowserProjectStore;
}

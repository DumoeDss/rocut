import type { BrowserProjectStore } from "@/services/storage/browser-project-store";

export interface ProjectStore {
	implementation(): BrowserProjectStore;
}

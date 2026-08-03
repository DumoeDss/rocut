import type { TProject } from "@/project/types";

export interface ProjectStore {
	load(): Promise<TProject>;
}

import type { TProject } from "../../editor-classic/src/project/types";

export interface ProjectStore {
	load(): Promise<TProject>;
}

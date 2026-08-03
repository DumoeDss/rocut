import { createInMemoryPorts } from "@/editor/ports/in-memory";

export function createViteEditorHost() {
	return { ...createInMemoryPorts() };
}

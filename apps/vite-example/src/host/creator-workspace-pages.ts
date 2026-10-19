const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PAGES = 64;
const encoder = new TextEncoder();

interface WorkspacePage {
	transport: "workspace-pages-v1";
	token: string;
	projectId: string;
	revision: string;
	pageCount: number;
	totalBytes: number;
	index: number;
	chunk: string;
}

export function isWorkspacePage(value: unknown): value is WorkspacePage {
	if (!value || typeof value !== "object") return false;
	if (
		!("transport" in value) ||
		!("token" in value) ||
		!("projectId" in value) ||
		!("revision" in value) ||
		!("pageCount" in value) ||
		!("totalBytes" in value) ||
		!("index" in value) ||
		!("chunk" in value)
	)
		return false;
	const page = value;
	return (
		page.transport === "workspace-pages-v1" &&
		typeof page.token === "string" &&
		page.token.length > 0 &&
		page.token.length <= 100 &&
		typeof page.projectId === "string" &&
		page.projectId.length > 0 &&
		typeof page.revision === "string" &&
		page.revision.length <= 200 &&
		Number.isSafeInteger(page.pageCount) &&
		Number(page.pageCount) > 0 &&
		Number(page.pageCount) <= MAX_PAGES &&
		Number.isSafeInteger(page.totalBytes) &&
		Number(page.totalBytes) >= 0 &&
		Number(page.totalBytes) <= MAX_BYTES &&
		Number.isSafeInteger(page.index) &&
		Number(page.index) >= 0 &&
		Number(page.index) < Number(page.pageCount) &&
		typeof page.chunk === "string" &&
		encoder.encode(JSON.stringify(value)).byteLength <= 1024 * 1024
	);
}

/** Never expose a partial snapshot to the editor store. */
export async function assembleWorkspacePages({
	initial,
	read,
}: {
	initial: unknown;
	read: (token: string, index: number) => Promise<unknown>;
}): Promise<unknown> {
	if (!isWorkspacePage(initial) || initial.index !== 0)
		throw new Error("Invalid workspace page manifest");
	let serialized = initial.chunk;
	let bytes = encoder.encode(serialized).byteLength;
	for (let index = 1; index < initial.pageCount; index++) {
		const page = await read(initial.token, index);
		if (
			!isWorkspacePage(page) ||
			page.token !== initial.token ||
			page.index !== index ||
			page.projectId !== initial.projectId ||
			page.revision !== initial.revision ||
			page.totalBytes !== initial.totalBytes ||
			page.pageCount !== initial.pageCount
		)
			throw new Error("Workspace pages changed during transfer");
		bytes += encoder.encode(page.chunk).byteLength;
		if (bytes > MAX_BYTES || bytes > initial.totalBytes)
			throw new Error("Workspace transfer exceeds bounds");
		serialized += page.chunk;
	}
	if (bytes !== initial.totalBytes)
		throw new Error("Incomplete workspace transfer");
	const value: unknown = JSON.parse(serialized);
	if (
		!value ||
		typeof value !== "object" ||
		("projectId" in value &&
			Reflect.get(value, "projectId") !== initial.projectId) ||
		("projectId" in value &&
			Reflect.get(value, "revision") !== initial.revision)
	)
		throw new Error("Workspace payload does not match its fixed manifest");
	return value;
}

import {
	isHostExportOptions,
	type HostExportOptions,
} from "./host-export-protocol";

export interface CompositionExportSource {
	readonly projectId: string;
	readonly revision: number;
	readonly data: unknown;
}

export type CompositionExportCommand =
	| {
			readonly command: "composition.export.cancel";
			readonly requestId: string;
			readonly jobId: string;
	  }
	| {
			readonly command: "composition.export.start";
			readonly requestId: string;
			readonly jobId: string;
			readonly token: string;
			readonly receipt: unknown;
			readonly options: HostExportOptions;
			readonly source: CompositionExportSource;
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCompositionExportCommand(
	value: Record<string, unknown>,
): CompositionExportCommand | null {
	const { command, requestId, jobId } = value;
	if (
		typeof requestId !== "string" ||
		!/^[a-f0-9]{64}$/.test(requestId) ||
		typeof jobId !== "string" ||
		!jobId
	)
		return null;
	if (command === "composition.export.cancel")
		return { command, requestId, jobId };
	if (
		command !== "composition.export.start" ||
		typeof value.token !== "string" ||
		!value.token ||
		!isRecord(value.receipt) ||
		!isRecord(value.options) ||
		!isHostExportOptions(value.options) ||
		!isRecord(value.source) ||
		typeof value.source.projectId !== "string" ||
		!/^composition:[a-f0-9]{64}$/.test(value.source.projectId) ||
		value.source.revision !== 0 ||
		!isRecord(value.source.data)
	)
		return null;
	return {
		command,
		requestId,
		jobId,
		token: value.token,
		receipt: value.receipt,
		options: value.options,
		source: {
			projectId: value.source.projectId,
			revision: 0,
			data: value.source.data,
		},
	};
}

type Scope = { requestId: string; jobId: string; token: string };
function route({
	scope,
	endpoint,
	baseUrl,
}: {
	scope: Scope;
	endpoint: "progress" | "result";
	baseUrl: string;
}) {
	return new URL(
		`api/composition-productions/${encodeURIComponent(scope.requestId)}/exports/${encodeURIComponent(scope.jobId)}/${endpoint}`,
		baseUrl,
	);
}

export function createCompositionExportTransport({
	fetchImpl = fetch,
	baseUrl = location.href,
}: {
	fetchImpl?: (
		input: RequestInfo | URL,
		init?: RequestInit,
	) => Promise<Response>;
	baseUrl?: string;
} = {}) {
	return {
		async progress({ scope, progress }: { scope: Scope; progress: number }) {
			const response = await fetchImpl(
				route({ scope, endpoint: "progress", baseUrl }),
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-native-export-token": scope.token,
					},
					body: JSON.stringify({ progress }),
				},
			);
			if (!response.ok) throw new Error("composition-export-progress-rejected");
			const result: unknown = await response.json();
			return isRecord(result) && result.cancelRequested === true;
		},
		async upload({ scope, bytes }: { scope: Scope; bytes: ArrayBuffer }) {
			const response = await fetchImpl(
				route({ scope, endpoint: "result", baseUrl }),
				{
					method: "POST",
					headers: {
						"content-type": "application/octet-stream",
						"x-native-export-token": scope.token,
					},
					body: bytes,
				},
			);
			if (!response.ok) throw new Error("composition-export-result-rejected");
		},
		async failure({
			scope,
			error,
			terminated = false,
		}: {
			scope: Scope;
			error: string;
			terminated?: boolean;
		}) {
			const url = route({ scope, endpoint: "result", baseUrl });
			url.searchParams.set("error", error);
			if (terminated) url.searchParams.set("terminated", "true");
			const response = await fetchImpl(url, {
				method: "POST",
				headers: { "x-native-export-token": scope.token },
			});
			if (!response.ok) throw new Error("composition-export-failure-rejected");
		},
	};
}

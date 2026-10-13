import { expect, test } from "bun:test";
import { createCompositionExportController } from "./composition-export-controller";
import {
	createCompositionExportTransport,
	parseCompositionExportCommand,
	type CompositionExportCommand,
} from "./host-composition-export";
type Start = Extract<
	CompositionExportCommand,
	{ command: "composition.export.start" }
>;

const start = ({
	requestId = "request",
	jobId = "job",
}: { requestId?: string; jobId?: string } = {}) => ({
	command: "composition.export.start" as const,
	requestId,
	jobId,
	token: "private-token",
	options: { format: "mp4" as const, quality: "high" as const },
	receipt: { jobId },
	source: { projectId: `composition:${"a".repeat(64)}`, revision: 0, data: {} },
});
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function fixture() {
	const uploads: string[] = [],
		failures: string[] = [],
		verifies: string[] = [];
	let release: (result: {
		success: boolean;
		buffer?: ArrayBuffer;
	}) => void = () => {};
	let renders = 0;
	let renderArgs:
		| Parameters<
				Parameters<typeof createCompositionExportController>[0]["render"]
		  >[0]
		| undefined;
	const busy = { current: false };
	const deps = {
		isBusy: () => busy.current,
		setBusy: (value: boolean) => {
			busy.current = value;
		},
		verify: (command: Start) => {
			verifies.push(command.jobId);
		},
		render: (args: NonNullable<typeof renderArgs>) => {
			renders++;
			renderArgs = args;
			return new Promise<{ success: boolean; buffer?: ArrayBuffer }>(
				(resolve) => {
					release = resolve;
				},
			);
		},
		transport: {
			progress: async () => false,
			upload: async ({ scope }: { scope: Start }) => {
				uploads.push(scope.requestId);
			},
			failure: async ({
				scope,
				error,
				terminated,
			}: {
				scope: Start;
				error: string;
				terminated?: boolean;
			}) => {
				failures.push(`${scope.requestId}:${error}:${terminated === true}`);
			},
		},
	};
	const controller = createCompositionExportController(deps);
	return {
		controller,
		deps,
		busy,
		uploads,
		failures,
		verifies,
		get renders() {
			return renders;
		},
		get args() {
			return renderArgs!;
		},
		finish: () => release({ success: true, buffer: new ArrayBuffer(1) }),
	};
}

test("isolated command parsing requires explicit source identity and compound scope", () => {
	const command = start({ requestId: "a".repeat(64) });
	expect(parseCompositionExportCommand(command)).toEqual(command);
	for (const patch of [
		{ requestId: "" },
		{ token: "" },
		{ source: { ...start().source, revision: 1 } },
		{ source: { ...start().source, projectId: "active" } },
	])
		expect(parseCompositionExportCommand({ ...command, ...patch })).toBeNull();
});

test("composition routes remain below authenticated root and use native token/raw bytes", async () => {
	const requests: { url: URL; options?: RequestInit }[] = [];
	const transport = createCompositionExportTransport({
		baseUrl: "https://host/token/",
		fetchImpl: async (input, options) => {
			requests.push({ url: new URL(String(input)), options });
			return new Response(JSON.stringify({ cancelRequested: true }));
		},
	});
	const scope = start({ requestId: "request/a", jobId: "job/b" });
	expect(await transport.progress({ scope, progress: 0.5 })).toBe(true);
	const bytes = new ArrayBuffer(3);
	await transport.upload({ scope, bytes });
	await transport.failure({ scope, error: "cancelled", terminated: true });
	expect(requests[0].url.pathname).toBe(
		"/token/api/composition-productions/request%2Fa/exports/job%2Fb/progress",
	);
	expect(requests[0].options?.headers).toEqual({
		"content-type": "application/json",
		"x-native-export-token": "private-token",
	});
	expect(requests[1].options?.body).toBe(bytes);
	expect(requests[2].url.searchParams.get("terminated")).toBe("true");
});

test("source is sealed, verified before render and again before upload; replays render once", async () => {
	const f = fixture(),
		command = start();
	f.controller.handle(command);
	command.source.data = { mutated: true };
	expect(f.args.source.data).toEqual({});
	f.finish();
	await flush();
	expect(f.verifies).toEqual(["job", "job"]);
	expect(f.uploads).toEqual(["request"]);
	f.controller.handle(start());
	await flush();
	expect(f.renders).toBe(1);
});

test("cancellation is scoped by request and waits for renderer drain before releasing busy", async () => {
	const f = fixture();
	f.controller.handle(start());
	f.controller.handle({
		command: "composition.export.cancel",
		requestId: "other",
		jobId: "job",
	});
	expect(f.args.onCancel()).toBe(false);
	f.controller.handle({
		command: "composition.export.cancel",
		requestId: "request",
		jobId: "job",
	});
	expect(f.args.onCancel()).toBe(true);
	expect(f.busy.current).toBe(true);
	f.finish();
	await flush();
	expect(f.busy.current).toBe(false);
	expect(f.uploads).toEqual([]);
	expect(f.failures).toEqual(["request:cancelled:true"]);
});

test("disconnect cancels detached render without upload", async () => {
	const f = fixture();
	f.controller.handle(start());
	f.controller.disconnect();
	f.finish();
	await flush();
	expect(f.uploads).toEqual([]);
	expect(f.failures).toEqual(["request:cancelled:true"]);
});

test("shared GPU busy prevents overlapping ordinary or isolated exports", async () => {
	const f = fixture();
	f.busy.current = true;
	f.controller.handle(start());
	await flush();
	expect(f.renders).toBe(0);
	expect(f.busy.current).toBe(true);
	expect(f.failures.length).toBe(1);
});

test("post-render verification failure blocks publication", async () => {
	const f = fixture();
	let calls = 0;
	f.deps.verify = () => {
		if (++calls === 2) throw new Error("stale source");
	};
	f.controller.handle(start());
	f.finish();
	await flush();
	expect(f.uploads).toEqual([]);
	expect(f.failures[0]).toContain("stale source");
});

test("progress cancellation arriving after encode still blocks upload", async () => {
	const f = fixture();
	f.deps.transport.progress = async () => true;
	f.controller.handle(start());
	f.args.onProgress({ progress: 1 });
	f.finish();
	await flush();
	expect(f.uploads).toEqual([]);
	expect(f.failures).toEqual(["request:cancelled:true"]);
});

test("invalid receipt fails before render and releases GPU lock", async () => {
	const f = fixture();
	f.deps.verify = () => {
		throw new Error("invalid digest");
	};
	f.controller.handle(start());
	await flush();
	expect(f.renders).toBe(0);
	expect(f.uploads).toEqual([]);
	expect(f.busy.current).toBe(false);
	expect(f.failures[0]).toContain("invalid digest");
});

test("conflicting replay cancels running job instead of publishing under changed identity", async () => {
	const f = fixture();
	f.controller.handle(start());
	f.controller.handle({ ...start(), token: "changed" });
	await flush();
	expect(f.args.onCancel()).toBe(true);
	f.finish();
	await flush();
	expect(f.uploads).toEqual([]);
	expect(f.renders).toBe(1);
});

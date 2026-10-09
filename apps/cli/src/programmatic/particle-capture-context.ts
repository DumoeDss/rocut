import type { FrameBrowserEvent } from "./chromium-process";
import type { ParticleBrowser } from "./particle-broker";

/** The binding belongs to the host-owned outer realm. Authored code runs in a
 * separate opaque iframe and can reach it only through the fixed page relay. */
export async function enableParticleRootContext(options: {
	browser: ParticleBrowser;
	session: string;
	signal: AbortSignal;
	timeoutMs: number;
}) {
	const { browser, session, signal, timeoutMs } = options;
	if (
		!session ||
		!Number.isSafeInteger(timeoutMs) ||
		timeoutMs < 1 ||
		timeoutMs > 30_000
	)
		throw Error("Particle context requires a session and bounded deadline");
	signal.throwIfAborted();
	let rootFrame: string | undefined;
	let selected: number | undefined;
	let disposed = false;
	let problem: Error | undefined;
	let rejectFailure!: (error: Error) => void;
	let resolveContext!: (id: number) => void;
	const candidates = new Map<string, number>();
	const failure = new Promise<never>((_, reject) => {
		rejectFailure = reject;
	});
	void failure.catch(() => {});
	const ready = new Promise<number>((resolve) => {
		resolveContext = resolve;
	});
	const fail = (error: Error) => {
		if (problem || disposed) return;
		problem = error;
		rejectFailure(error);
	};
	const choose = () => {
		if (!rootFrame || problem || disposed) return;
		const id = candidates.get(rootFrame);
		if (id === undefined) return;
		if (selected !== undefined && selected !== id) {
			fail(Error("Particle root execution context was replaced"));
			return;
		}
		selected = id;
		resolveContext(id);
	};
	const onEvent = (event: FrameBrowserEvent) => {
		if (disposed || event.sessionId !== session) return;
		if (event.method === "Runtime.executionContextCreated") {
			const context = event.params.context as
				| { id?: unknown; auxData?: { frameId?: unknown; isDefault?: unknown } }
				| undefined;
			if (
				!context ||
				context.auxData?.isDefault !== true ||
				typeof context.auxData.frameId !== "string"
			)
				return;
			if (!Number.isSafeInteger(context.id) || (context.id as number) < 1) {
				fail(Error("Invalid particle root execution context"));
				return;
			}
			if (candidates.size >= 64 && !candidates.has(context.auxData.frameId)) {
				fail(Error("Particle context discovery exceeded its context bound"));
				return;
			}
			candidates.set(context.auxData.frameId, context.id as number);
			choose();
		} else if (event.method === "Runtime.executionContextDestroyed") {
			const id = event.params.executionContextId;
			for (const [frame, context] of candidates)
				if (context === id) candidates.delete(frame);
			if (id === selected)
				fail(Error("Particle root execution context was destroyed"));
		} else if (
			event.method === "Runtime.executionContextsCleared" ||
			event.method === "Inspector.detached"
		) {
			fail(Error("Particle execution contexts were cleared or detached"));
		} else if (event.method === "Page.frameNavigated") {
			const frame = event.params.frame as { id?: unknown } | undefined;
			if (selected !== undefined && frame?.id === rootFrame)
				fail(Error("Particle root frame navigated"));
		}
	};
	// Subscribe before Runtime.enable: Chromium emits existing default contexts
	// while enabling, and no page-originated binding event can select the realm.
	const unsubscribe = browser.onEvent(onEvent);
	const abort = () =>
		fail(
			Error("Particle context discovery/capture aborted", {
				cause: signal.reason,
			}),
		);
	signal.addEventListener("abort", abort, { once: true });
	const timer = setTimeout(
		() => fail(Error("Particle root context discovery timed out")),
		timeoutMs,
	);
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		clearTimeout(timer);
		unsubscribe();
		signal.removeEventListener("abort", abort);
		candidates.clear();
	};
	try {
		if (signal.aborted) abort();
		const tree = await Promise.race([
			browser.send("Page.getFrameTree", {}, session),
			failure,
		]);
		const frameTree = tree.frameTree as
			| { frame?: { id?: unknown } }
			| undefined;
		if (typeof frameTree?.frame?.id !== "string" || !frameTree.frame.id)
			throw Error("Particle capture requires a concrete root frame");
		rootFrame = frameTree.frame.id;
		choose();
		await Promise.race([browser.send("Runtime.enable", {}, session), failure]);
		const executionContextId = await Promise.race([ready, failure]);
		clearTimeout(timer);
		if (problem) throw problem;
		return {
			executionContextId,
			failure,
			check() {
				if (problem) throw problem;
				if (disposed) throw Error("Particle root context is disposed");
			},
			dispose,
		};
	} catch (error) {
		dispose();
		throw error;
	}
}

import { useCallback, useEffect, useRef, useState } from "react";

import type { EditorHost } from "@opencut/editor-ports/host";
import {
	createBrowserRuntimePorts,
	type BrowserRuntimePortsOptions,
} from "@/editor/host/browser-runtime";
import { EditorHostProvider } from "@/editor/host/editor-host-context";
import { createInMemoryPorts } from "@opencut/editor-ports/in-memory";
import {
	createEditorSession,
	EditorSessionProvider,
	type EditorSession,
	useEditorSession,
} from "@/editor/session";
import { fontChunkUrl, quoteCssUrl } from "@/fonts/google-fonts";
import { useFontAtlas } from "@/fonts/use-font-atlas";

const FIXTURES = {
	a: { base: "/c4-a/", fontName: "C4 Atlas Alpha", chunk: 1 },
	b: { base: "/c4-b/", fontName: "C4 Atlas Beta Session", chunk: 3 },
} as const;

type SessionLabel = keyof typeof FIXTURES;

interface ProbeObservation {
	status: string;
	fontName: string | null;
	chunkUrl: string | null;
	maskUrl: string | null;
}

type HarnessState =
	| { status: "starting" }
	| { status: "ready"; sessions: Readonly<Record<SessionLabel, EditorSession>> }
	| { status: "error"; error: string };

function atlasFixture({ fontName, chunk }: (typeof FIXTURES)[SessionLabel]) {
	return {
		fonts: {
			[fontName]: { x: 7, y: 11, w: 96, ch: chunk, s: [fontName] },
		},
	};
}

function inputUrl(
	input: Parameters<NonNullable<BrowserRuntimePortsOptions["fetch"]>>[0],
) {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

function createHarnessHost({
	label,
	onFetch,
}: {
	label: SessionLabel;
	onFetch: (url: string) => void;
}): EditorHost {
	const fixture = FIXTURES[label];
	const bytes = new TextEncoder().encode(JSON.stringify(atlasFixture(fixture)));
	const browser = createBrowserRuntimePorts({
		base: fixture.base,
		fetch: async (input) => {
			const url = inputUrl(input);
			onFetch(url);
			return new Response(bytes, {
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		},
	});
	const sequence = new Map<string, number>();
	const host: EditorHost = {
		...createInMemoryPorts(),
		...browser,
		ids: {
			next: ({ scope }) => {
				const next = (sequence.get(scope) ?? 0) + 1;
				sequence.set(scope, next);
				return `c4-${label}-${scope}-${next}`;
			},
		},
		projectId: `c4-project-${label}`,
		navigation: {
			onProjectReplaced: () => {},
			onExitProject: () => {},
			onGoBack: () => {},
		},
		services: {},
		branding: {
			logoUrl: browser.assets.resolve({
				ref: { path: "logos/opencut/svg/logo.svg" },
			}),
		},
		links: {
			discordUrl: "https://discord.com/invite/Mu3acKZvCp",
			roadmapUrl: "https://opencut.app/roadmap",
		},
	};
	return Object.freeze(host);
}

export function C4SessionHarness() {
	const mountTargets = {
		a: useRef<HTMLDivElement>(null),
		b: useRef<HTMLDivElement>(null),
	};
	const [state, setState] = useState<HarnessState>({ status: "starting" });
	const [fetchCalls, setFetchCalls] = useState<string[]>([]);
	const [preloadUrls, setPreloadUrls] = useState<string[]>([]);
	const [observations, setObservations] = useState<
		Partial<Record<SessionLabel, ProbeObservation>>
	>({});
	const owned = useRef<EditorSession[]>([]);

	useEffect(() => {
		let cancelled = false;
		const originalImage = globalThis.Image;
		class RecordingImage {
			private value = "";
			set src(value: string) {
				this.value = value;
				if (!cancelled) setPreloadUrls((current) => [...current, value]);
			}
			get src() {
				return this.value;
			}
		}
		(globalThis as unknown as { Image: typeof Image }).Image =
			RecordingImage as unknown as typeof Image;

		const publishFetch = (url: string) => {
			if (!cancelled) setFetchCalls((current) => [...current, url]);
		};

		void (async () => {
			const created: EditorSession[] = [];
			try {
				const targetA = mountTargets.a.current;
				const targetB = mountTargets.b.current;
				if (!targetA || !targetB) {
					throw new Error("C4 session mount targets were not rendered.");
				}
				const hostA = createHarnessHost({ label: "a", onFetch: publishFetch });
				const hostB = createHarnessHost({ label: "b", onFetch: publishFetch });
				const [sessionA, sessionB] = await Promise.all([
					createEditorSession({ host: hostA }).then((session) => {
						created.push(session);
						return session;
					}),
					createEditorSession({ host: hostB }).then((session) => {
						created.push(session);
						return session;
					}),
				]);
				if (cancelled) {
					await Promise.allSettled([sessionA.dispose(), sessionB.dispose()]);
					return;
				}
				owned.current = [sessionA, sessionB];
				const rootA = sessionA.mount({ target: targetA });
				const rootB = sessionB.mount({ target: targetB });
				await Promise.all([rootA.ready, rootB.ready]);
				if (cancelled) return;
				setState({
					status: "ready",
					sessions: { a: sessionA, b: sessionB },
				});
			} catch (error) {
				await Promise.allSettled(created.map((session) => session.dispose()));
				const createdSet = new Set(created);
				owned.current = owned.current.filter(
					(session) => !createdSet.has(session),
				);
				if (!cancelled) {
					setState({
						status: "error",
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}
		})();

		return () => {
			cancelled = true;
			if (globalThis.Image === (RecordingImage as unknown as typeof Image)) {
				(globalThis as unknown as { Image: typeof Image }).Image =
					originalImage;
			}
			const sessions = owned.current;
			owned.current = [];
			void Promise.allSettled(sessions.map((session) => session.dispose()));
		};
	}, []);

	const observe = useCallback(
		(label: SessionLabel, observation: ProbeObservation) => {
			setObservations((current) => {
				const previous = current[label];
				if (
					previous?.status === observation.status &&
					previous.fontName === observation.fontName &&
					previous.chunkUrl === observation.chunkUrl &&
					previous.maskUrl === observation.maskUrl
				) {
					return current;
				}
				return { ...current, [label]: observation };
			});
		},
		[],
	);

	const isolated = (["a", "b"] as const).every((label) => {
		const fixture = FIXTURES[label];
		const observation = observations[label];
		const chunkUrl = `${fixture.base}fonts/font-chunk-${fixture.chunk}.avif`;
		return (
			observation?.status === "idle" &&
			observation.fontName === fixture.fontName &&
			observation.chunkUrl === chunkUrl &&
			observation.maskUrl === quoteCssUrl(chunkUrl) &&
			fetchCalls.includes(`${fixture.base}fonts/font-atlas.json`) &&
			preloadUrls.includes(chunkUrl)
		);
	});

	return (
		<main
			data-testid="c4-session-harness"
			data-status={state.status}
			data-cache-isolated={isolated ? "true" : "false"}
		>
			<h1>C4 simultaneous Host/session font assets</h1>
			<div ref={mountTargets.a} data-testid="c4-session-mount-a" />
			<div ref={mountTargets.b} data-testid="c4-session-mount-b" />
			{state.status === "error" ? (
				<pre data-testid="c4-session-error">{state.error}</pre>
			) : null}
			{state.status === "ready" ? (
				<div data-testid="c4-session-trees">
					<EditorHostProvider host={state.sessions.a.host}>
						<EditorSessionProvider session={state.sessions.a}>
							<SessionAssetProbe label="a" onObservation={observe} />
						</EditorSessionProvider>
					</EditorHostProvider>
					<EditorHostProvider host={state.sessions.b.host}>
						<EditorSessionProvider session={state.sessions.b}>
							<SessionAssetProbe label="b" onObservation={observe} />
						</EditorSessionProvider>
					</EditorHostProvider>
				</div>
			) : null}
			<output data-testid="c4-loader-fetch-calls">
				{JSON.stringify(fetchCalls)}
			</output>
			<output data-testid="c4-preload-urls">
				{JSON.stringify(preloadUrls)}
			</output>
		</main>
	);
}

function SessionAssetProbe({
	label,
	onObservation,
}: {
	label: SessionLabel;
	onObservation: (label: SessionLabel, observation: ProbeObservation) => void;
}) {
	const fixture = FIXTURES[label];
	const session = useEditorSession();
	const { atlas, status } = useFontAtlas({ open: true });
	const fontName = Object.keys(atlas?.fonts ?? {})[0] ?? null;
	const entry = fontName ? atlas?.fonts[fontName] : undefined;
	const chunkUrl = entry
		? fontChunkUrl({ resolver: session.host.assets, chunk: entry.ch })
		: null;
	const maskUrl = chunkUrl ? quoteCssUrl(chunkUrl) : null;

	useEffect(() => {
		onObservation(label, { status, fontName, chunkUrl, maskUrl });
	}, [chunkUrl, fontName, label, maskUrl, onObservation, status]);

	return (
		<section
			data-testid={`c4-session-${label}`}
			data-session-id={session.id}
			data-project-id={session.projectId}
			data-lifecycle={session.state}
			data-host-base={fixture.base}
			data-atlas-status={status}
		>
			<h2>Session {label.toUpperCase()}</h2>
			<p data-testid={`c4-font-name-${label}`}>{fontName ?? "loading"}</p>
			<output data-testid={`c4-atlas-bytes-${label}`}>
				{JSON.stringify(atlasFixture(fixture))}
			</output>
			<output data-testid={`c4-chunk-url-${label}`}>{chunkUrl ?? ""}</output>
			<output data-testid={`c4-mask-url-${label}`}>{maskUrl ?? ""}</output>
		</section>
	);
}

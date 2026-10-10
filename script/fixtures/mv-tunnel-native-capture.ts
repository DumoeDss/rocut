import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "../../packages/editor-contracts/src";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { resolveMvResourceFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-resource-frame";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { prepareMvNativeRasterTicket } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-native-admission";
import { runMvNativeRaster } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-native-runtime";
import type { TypeCardReferenceFont } from "./mv-type-card-reference-contract";
import type { TunnelNativeCapture } from "./mv-tunnel-pixel-suite";
import { TUNNEL_FONTS } from "./mv-tunnel-matrix";
import { typeCardReferenceDigest } from "./mv-type-card-reference-realm";
import { openTunnelNativeReplay } from "./mv-tunnel-native-replay";
import { prepareTunnelFontPacket } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-tunnel-font-packet";

/** Actual public producer/metric/raster adapter. Never imports archived drawing
 * or GL reference code, never invents metrics. Negatives replay the actual Rust
 * plan in a private trusted native realm; metric negatives re-enter Rust first.
 */
export function createTunnelNativeCapture(
	fonts: readonly TypeCardReferenceFont[],
): Promise<TunnelNativeCapture> {
	return createCapture({ fonts });
}
export function createTunnelNativeDiagnosticCapture({
	fonts,
	onPlan,
}: {
	fonts: readonly TypeCardReferenceFont[];
	onPlan(plan: unknown): void;
}): Promise<TunnelNativeCapture> {
	return createCapture({ fonts, diagnostic: { onPlan } });
}
async function createCapture({
	fonts,
	diagnostic,
}: {
	fonts: readonly TypeCardReferenceFont[];
	diagnostic?: { onPlan(plan: unknown): void };
}): Promise<TunnelNativeCapture> {
	const roleIds = [
		"mincho800",
		"dot400",
		"heavy900",
		"noto400",
		"noto800",
		"noto900",
	] as const;
	const resources: ResolvedProgrammaticResource[] = [];
	for (const [i, expected] of TUNNEL_FONTS.entries()) {
		const found = fonts.filter(
			(f) => f.family === expected.family && f.weight === expected.weight,
		);
		if (found.length !== 1)
			throw Error("Tunnel native capture requires exact six font roles");
		const body = found[0].bytes.slice(0);
		const sha256 = await typeCardReferenceDigest(body);
		resources.push({
			body,
			resource: {
				id: roleIds[i],
				kind: "font",
				attachmentKey: `programmatic-sha256-${sha256}`,
				mimeType: "font/ttf",
				byteLength: body.byteLength,
				sha256,
				font: {
					family: expected.family,
					style: "normal",
					weight: expected.weight,
					...(expected.family === "Noto Serif JP"
						? { axes: { wght: expected.weight } }
						: {}),
				},
			},
		});
	}
	const fontHashes = Object.fromEntries(
		resources.map(({ resource }) => [
			`${resource.font?.family}|${resource.font?.weight}`,
			resource.sha256,
		]),
	);
	const pixels = (bitmap: ImageBitmap) => {
		const canvas = document.createElement("canvas");
		canvas.width = 1920;
		canvas.height = 1080;
		try {
			const ctx = canvas.getContext("2d");
			if (!ctx) throw Error("Tunnel capture requires native Canvas2D");
			ctx.drawImage(bitmap, 0, 0);
			return ctx.getImageData(0, 0, 1920, 1080).data.slice();
		} finally {
			bitmap.close();
			canvas.width = canvas.height = 1;
		}
	};
	return async ({ frame, index, control, postControl }) => {
		const durationFrames = frame.duration * 60;
		if (
			!Number.isSafeInteger(durationFrames) ||
			index < 0 ||
			index >= durationFrames ||
			frame.time !== frame.shotStart + index / 60
		)
			throw Error("Tunnel capture requires exact matrix frame/tick mapping");
		const source: ProgrammaticSource = {
			version: 1,
			runtime: "canvas-worker",
			code: "",
			width: 1920,
			height: 1080,
			frameRate: { numerator: 60, denominator: 1 },
			durationFrames,
			seed: 4242,
			resources: resources.map((r) => r.resource),
			recipe: {
				version: 1,
				root: "tunnel",
				songStartSeconds: frame.shotStart,
				outputRoles: ["graphics"],
				nodes: [
					{
						id: "tunnel",
						scene: {
							kind: "tunnel",
							role: "graphics",
							span: { startFrame: 0, durationFrames },
							settings: {
								...frame.args,
								fonts: {
									mincho800: roleIds[0],
									dot400: roleIds[1],
									heavy900: roleIds[2],
									noto400: roleIds[3],
									noto800: roleIds[4],
									noto900: roleIds[5],
								},
								beats: {
									kind: "manual",
									songTicks: frame.beats.map((t) => Math.round(t * 120000)),
								},
								bpm: frame.bpm,
								downbeatIndex0: frame.downbeatIndex0,
							},
						},
					},
				],
				post: [],
			},
		};
		const pending = resolveProgrammaticFrame({
			source,
			clipStart: 0,
			clipDuration: 1,
			trimStart: index * 2000,
			timelineTime: 0,
		});
		if (!pending) throw Error("Tunnel public source discovery failed");
		let evaluated = await resolveMvResourceFrame({
			source,
			frame: pending,
			resources,
		});
		const applied: Record<string, number> = {};
		const replay =
			control || postControl ? await openTunnelNativeReplay() : undefined;
		try {
			if (control === "real-advance") {
				if (
					!pending.tunnelFontByteRequests ||
					!pending.tunnelFontLimits ||
					!replay
				)
					throw Error("Tunnel metric negative requires genuine byte discovery");
				const prepared = await prepareTunnelFontPacket({
					requests: pending.tunnelFontByteRequests,
					limits: pending.tunnelFontLimits,
					resources,
				});
				const evaluation = {
					source,
					clipStart: 0,
					clipDuration: 1,
					trimStart: index * 2000,
					timelineTime: 0,
					tunnelFontPacket: prepared.packet,
				};
				const admitted = resolveProgrammaticFrame(evaluation);
				if (!admitted?.tunnelFontMetricRequests?.length)
					throw Error("Tunnel metric negative requires genuine Rust requests");
				await replay.runtime.load(admitted, prepared.resources);
				const fontRoles: Record<string, string> = {};
				for (const request of admitted.tunnelFontMetricRequests)
					fontRoles[request.fontStack.aliases[0]] = request.fontStack.role;
				const { ctx } = replay.surface({
					control: { name: control, applied },
					fontRoles,
				});
				const measurements = [];
				for (const request of admitted.tunnelFontMetricRequests)
					measurements.push(await replay.runtime.measure(ctx, request));
				const final = resolveProgrammaticFrame({
					...evaluation,
					tunnelFontMeasurements: measurements,
				});
				if (!final?.recipePlan || final.tunnelFontMetricRequests?.length)
					throw Error("Tunnel negative native facts were not resolved by Rust");
				evaluated = { ...final, tunnelFontMeasurements: measurements };
				replay.release();
			}
			const root = evaluated.recipePlan?.root;
			if (
				root?.kind !== "tunnel" ||
				evaluated.tunnelFontMetricRequests?.length ||
				evaluated.tunnelFontByteRequests?.length
			)
				throw Error("Tunnel official producer/font admission incomplete");
			// Opt-in fixture observation only; normal public raster paths stay intact.
			diagnostic?.onPlan(structuredClone(root));
			const measured = evaluated.tunnelFontMeasurements;
			if (!measured || measured.length !== 3)
				throw Error("Tunnel actual native measured stack receipts missing");
			const role = (name: string) => {
				const found = measured.find(
					(m) => m.nodeId === "tunnel" && m.fontStack.role === name,
				);
				if (!found) throw Error("Tunnel measured node role missing");
				return found.advances;
			};
			const sceneTicket = await prepareMvNativeRasterTicket({
				source,
				frame: pending,
				resources,
				diagnosticNativePostMode: "scene-only",
			});
			let scenePixels = pixels(
				await runMvNativeRaster({ ticket: sceneTicket }),
			);
			let postPixels = pixels(
				await renderProgrammaticCanvas({ source, frame: pending, resources }),
			);
			if (replay) {
				const result = await replay.render({
					frame: evaluated,
					resources,
					control:
						control && control !== "identity" && control !== "real-advance"
							? { name: control, applied }
							: undefined,
					postControl,
					applied,
				});
				if (control === "identity") {
					if (
						scenePixels.some((v, i) => v !== result.pixels[i]) ||
						postPixels.some((v, i) => v !== result.postPixels[i])
					)
						throw Error(
							"Tunnel controlled replay differs from official native identity",
						);
				}
				scenePixels = result.pixels;
				postPixels = result.postPixels;
				if (control && control !== "identity" && !(applied[control] > 0))
					throw Error("Tunnel scene control did not reach native boundary");
				if (postControl && !(applied[postControl] > 0))
					throw Error(
						"Tunnel post control did not reach native uniform boundary",
					);
			}
			return {
				pixels: scenePixels,
				postPixels,
				post: { ...root.nativePost.parameters },
				metrics: { mincho800: role("mincho800"), dot400: role("dot400") },
				proof: {
					planKind: "tunnel",
					runtime: "renderProgrammaticCanvas",
					pendingMetricRequestsBefore: measured.length,
					pendingMetricRequestsAfter: 0,
					fontHashes,
					sourceIdentity: await typeCardReferenceDigest(
						new TextEncoder().encode(JSON.stringify(source)).buffer,
					),
					postBackend: "controlled-reference-post-v1",
					controlApplications: applied,
				},
			};
		} finally {
			replay?.dispose();
		}
	};
}

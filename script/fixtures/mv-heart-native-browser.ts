import { MvHeartOwner } from "opencut-wasm";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import {
	heartNativeFixture,
	heartNativeDigest,
	HEART_NATIVE_KINDS,
	type HeartNativeKind,
} from "./mv-heart-native-fixture";
import { exerciseHeartNativeCancellation } from "./mv-heart-native-cancellation";

declare global {
	var __heartNativeResult: unknown;
	var __heartNativeProgress: string;
}
const checks: Record<string, boolean> = {};
const observations: {
	kind: string;
	frame: number;
	sha256: string;
	nontransparent: number;
	png: string;
}[] = [];
function check({ name, valid }: { name: string; valid: boolean }) {
	checks[name] = valid;
	if (!valid) throw Error(`Heart native dispatch failed: ${name}`);
}
async function run() {
	const fixture = await heartNativeFixture();
	const observer = new MvHeartOwner();
	const diagnostics = () => {
		const value: {
			globalOwners: number;
			globalSessions: number;
			globalReservedBytes: number;
		} = JSON.parse(observer.diagnosticJson());
		return [
			value.globalOwners,
			value.globalSessions,
			value.globalReservedBytes,
		];
	};
	const baseline = JSON.stringify(diagnostics());
	const frameFor = ({
		kind,
		frame,
	}: {
		kind: HeartNativeKind;
		frame: number;
	}) => {
		const source = fixture.source(kind);
		const resolved = resolveProgrammaticFrame({
			source,
			clipStart: 0,
			clipDuration: 600000,
			trimStart: 0,
			timelineTime: frame * 4000,
		});
		if (!resolved) throw Error("Missing native public frame");
		return { source, frame: resolved, resources: fixture.resources };
	};
	try {
		for (const kind of HEART_NATIVE_KINDS) {
			for (const frame of [24, 36, 24]) {
				globalThis.__heartNativeProgress = `${kind}/${frame}`;
				const bitmap = await renderProgrammaticCanvas(
					frameFor({ kind, frame }),
				);
				const canvas = document.createElement("canvas");
				canvas.width = bitmap.width;
				canvas.height = bitmap.height;
				try {
					check({
						name: `${kind}/${frame}/output-size`,
						valid: bitmap.width === 1920 && bitmap.height === 1080,
					});
					const ctx = canvas.getContext("2d", { willReadFrequently: true });
					if (!ctx) throw Error("Native output readback unavailable");
					ctx.drawImage(bitmap, 0, 0);
					const pixels = ctx.getImageData(
						0,
						0,
						bitmap.width,
						bitmap.height,
					).data;
					let nontransparent = 0;
					for (let i = 3; i < pixels.length; i += 4)
						if (pixels[i]) nontransparent++;
					check({
						name: `${kind}/${frame}/visible`,
						valid: nontransparent > 0,
					});
					const sha256 = await heartNativeDigest(pixels.buffer);
					const previous = observations.find(
						(row) => row.kind === kind && row.frame === frame,
					);
					if (previous)
						check({
							name: `${kind}/${frame}/repeat`,
							valid: previous.sha256 === sha256,
						});
					observations.push({
						kind,
						frame,
						sha256,
						nontransparent,
						png: canvas.toDataURL("image/png"),
					});
				} finally {
					bitmap.close();
					canvas.width = canvas.height = 1;
				}
				check({
					name: `${kind}/${frame}/owner-drained`,
					valid: JSON.stringify(diagnostics()) === baseline,
				});
				check({
					name: `${kind}/${frame}/realm-drained`,
					valid: document.querySelectorAll("iframe").length === 0,
				});
			}
			const before = observations.find(
				(row) => row.kind === kind && row.frame === 24,
			);
			const after = observations.find(
				(row) => row.kind === kind && row.frame === 36,
			);
			check({
				name: `${kind}/time-changes-pixels`,
				valid: !!before && !!after && before.sha256 !== after.sha256,
			});
		}
		const cancellation = await exerciseHeartNativeCancellation({
			render: (signal) =>
				renderProgrammaticCanvas({
					...frameFor({ kind: "heartShatter", frame: 24 }),
					signal,
				}),
		});
		check({
			name: "abort-owner-drained",
			valid: JSON.stringify(diagnostics()) === baseline,
		});
		const recovered = await renderProgrammaticCanvas(
			frameFor({ kind: "heartShatter", frame: 24 }),
		);
		recovered.close();
		check({
			name: "abort-recovery-owner-drained",
			valid: JSON.stringify(diagnostics()) === baseline,
		});
		return {
			passed: true,
			checks,
			observations,
			cancellation,
			inputDimensions: [1024, 1024],
			baseline: diagnostics(),
			exportTested: false,
			originalPixelParityTested: false,
			installedElectronTested: false,
		};
	} finally {
		observer.dispose();
		observer.free();
	}
}
run()
	.then((result) => {
		globalThis.__heartNativeResult = result;
	})
	.catch((error) => {
		globalThis.__heartNativeResult = {
			passed: false,
			checks,
			observations,
			error: String(error?.stack ?? error),
		};
	});

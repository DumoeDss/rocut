import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import { isProgrammaticAudioIdentity } from "@opencut/editor-ports/host";
import { programmaticAudioPolicyJson } from "opencut-wasm";
import { reviseHttpProgrammaticBuild } from "./http-programmatic-builds";
import { inspectHttpProgrammaticAnimation } from "./http-programmatic-animation";

export function createHttpProgrammaticFrames({
	base = "api",
}: { base?: string } = {}): ProgrammaticFrameProvider {
	return {
		inspectAnimation: ({ resource, signal }) =>
			inspectHttpProgrammaticAnimation({ base, resource, signal }),
		reviseBuild: ({ request, signal }) =>
			reviseHttpProgrammaticBuild({ base, request, signal }),
		async getAudioIdentity({ request, signal }) {
			const response = await fetch(
				`${base.replace(/\/$/, "")}/programmatic/audio/identity`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(request),
					signal,
				},
			);
			const data: unknown = await response.json();
			if (!response.ok)
				throw Error(
					data && typeof data === "object" && "error" in data
						? String(data.error)
						: `Native audio identity returned ${response.status}`,
				);
			if (!isProgrammaticAudioIdentity(data))
				throw Error("Invalid native audio identity response");
			return data;
		},
		async renderAudio({ request, signal }) {
			const response = await fetch(
				`${base.replace(/\/$/, "")}/programmatic/audio`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(request),
					signal,
				},
			);
			try {
				if (!response.ok) {
					const result = await response.json().catch(() => null);
					throw Error(
						result?.error ??
							`Native audio renderer returned ${response.status}`,
					);
				}
				if (
					response.headers.get("content-type") !==
						"application/vnd.rocut.audio-pcm" ||
					response.headers.get("x-rocut-audio-version") !== "1"
				)
					throw Error("Invalid native audio response format");
				const identityId = response.headers.get("x-rocut-audio-identity");
				const profile = response.headers.get("x-rocut-audio-profile");
				const identity =
					identityId || profile
						? { version: 1 as const, profile, id: identityId }
						: undefined;
				if (identity && !isProgrammaticAudioIdentity(identity))
					throw Error("Invalid native audio identity headers");
				const expected =
					request &&
					typeof request === "object" &&
					"expectedIdentity" in request
						? request.expectedIdentity
						: undefined;
				if (
					expected !== undefined &&
					(!isProgrammaticAudioIdentity(expected) ||
						identity?.id !== expected.id)
				)
					throw Error("Native audio runtime identity changed");
				const integer = (name: string) => {
					const value = response.headers.get(name);
					if (
						!value ||
						!/^\d+$/.test(value) ||
						!Number.isSafeInteger(Number(value))
					)
						throw Error(`Invalid native audio ${name}`);
					return Number(value);
				};
				const length = integer("content-length");
				const sampleRate = integer("x-rocut-sample-rate"),
					channels = integer("x-rocut-channels"),
					frames = integer("x-rocut-frames");
				const sampleOrigin = integer("x-rocut-sample-origin"),
					hasAudio = response.headers.get("x-rocut-has-audio");
				const policy = JSON.parse(programmaticAudioPolicyJson());
				if (
					channels !== policy.outputChannels ||
					!policy.sampleRates.includes(sampleRate) ||
					frames < 1 ||
					length !== frames * channels * 4 ||
					length > policy.maxPcmBytes ||
					!["0", "1"].includes(hasAudio ?? "")
				)
					throw Error("Invalid native audio response bounds");
				const reader = response.body?.getReader();
				if (!reader) throw Error("Missing native audio response body");
				const pcm = new Uint8Array(length);
				let size = 0;
				try {
					while (true) {
						const { value, done } = await reader.read();
						signal.throwIfAborted();
						if (done) break;
						if (size + value.length > length)
							throw Error("Native audio response exceeds declared length");
						pcm.set(value, size);
						size += value.length;
					}
					if (size !== length) throw Error("Truncated native audio response");
				} finally {
					try {
						await reader.cancel();
					} catch {
						/* Aborted fetch already rejected the body. */
					} finally {
						reader.releaseLock();
					}
				}
				return {
					pcm: pcm.buffer,
					sampleRate,
					channels,
					frames,
					sampleOrigin,
					hasAudio: hasAudio === "1",
					...(isProgrammaticAudioIdentity(identity) ? { identity } : {}),
				};
			} catch (error) {
				await response.body?.cancel().catch(() => {});
				throw error;
			}
		},
		async loadResource({ resource, signal }) {
			const response = await fetch(
				`${base.replace(/\/$/, "")}/programmatic/resources/load`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(resource),
					signal,
				},
			);
			if (!response.ok) {
				const result = await response.json().catch(() => null);
				throw new Error(
					result?.error ?? `Resource load returned ${response.status}`,
				);
			}
			return response.blob();
		},
		async renderPng({ request, signal }) {
			const response = await fetch(
				`${base.replace(/\/$/, "")}/programmatic/frame`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(request),
					signal,
				},
			);
			if (!response.ok) {
				const result = await response.json().catch(() => null);
				throw new Error(
					result?.error ?? `HTML rasterizer returned ${response.status}`,
				);
			}
			if (response.headers.get("content-type") !== "image/png")
				throw new Error("HTML rasterizer did not return PNG");
			return response.blob();
		},
	};
}

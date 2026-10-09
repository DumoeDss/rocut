/** Test oracle: calls the pinned native modules and real browser AudioParams.
 * Recording wrappers forward every operation to the original AudioParam. */
import {
	parseAutomation,
	resolveAutomation,
	resolveAutomationRange,
	sampleAutomationLane,
} from "@oracle/automation";
import { parseAudioFxChain, HF_AUDIO_FX } from "@oracle/registry";
import {
	buildFxChain,
	ensureAudioFxWorklets,
	chainNeedsWorklets,
} from "@oracle/graph";
import { scheduleChainAutomation } from "@oracle/scheduler";
import { chainTailSeconds } from "@oracle/tail";

let input, output;
function model(request) {
	const chain = parseAudioFxChain(JSON.stringify(request.chain));
	const parsed = parseAutomation(
		JSON.stringify(request.automation ?? { version: 1, lanes: [] }),
	);
	const automation = resolveAutomation(parsed, chain);
	return {
		chain,
		parsed,
		automation,
		tailSeconds: chainTailSeconds(chain, automation),
		staticTailSeconds: chainTailSeconds(chain),
	};
}
async function graphFor(context, chain, elapsed = 0) {
	if (chainNeedsWorklets(chain)) await ensureAudioFxWorklets(context);
	return buildFxChain(context, chain, elapsed);
}
function targetsOf(graph) {
	return [
		...graph.nodes.flatMap((node) =>
			Object.entries(node.handle.automation ?? {}).map(([key, targets]) => ({
				target: `fx.${node.id}.${key}`,
				targets,
			})),
		),
		...Object.entries(graph.presets).map(([id, targets]) => ({
			target: `fx.preset.${id}`,
			targets,
		})),
	];
}
function recordParam(param, target, index, events) {
	return {
		cancelScheduledValues(time) {
			events.push({ target, index, kind: "cancel", time });
			return param.cancelScheduledValues(time);
		},
		setValueAtTime(value, time) {
			events.push({ target, index, kind: "set", time, value });
			return param.setValueAtTime(value, time);
		},
		linearRampToValueAtTime(value, time) {
			events.push({ target, index, kind: "ramp", time, value });
			return param.linearRampToValueAtTime(value, time);
		},
		setValueCurveAtTime(values, time, duration) {
			try {
				const result = param.setValueCurveAtTime(values, time, duration);
				events.push({
					target,
					index,
					kind: "curve",
					time,
					duration,
					values: [...values],
				});
				return result;
			} catch (error) {
				events.push({
					target,
					index,
					kind: "curve-rejected",
					time,
					duration,
					error: String(error),
				});
				throw error;
			}
		},
	};
}

window.rocutFxAutomationOracle = {
	registry: HF_AUDIO_FX,
	async inspect(request) {
		const data = model(request);
		const context = new OfflineAudioContext(
			2,
			128,
			request.sampleRate ?? 48000,
		);
		const graph = await graphFor(context, data.chain);
		try {
			return {
				...data,
				lanes: data.automation.lanes.map((lane) => {
					const range = resolveAutomationRange(lane.target, data.chain);
					return {
						target: lane.target,
						range,
						samples: (request.sampleTimes ?? [0, 0.025, 0.05, 0.1, 1]).map(
							(time) => ({
								time,
								value: sampleAutomationLane(lane, time, range.scale),
							}),
						),
					};
				}),
				targets: targetsOf(graph).map(({ target, targets }) => ({
					target,
					range: resolveAutomationRange(target, data.chain),
					params: targets.map((item) => ({
						initialValue: item.param.value,
						automationRate: item.param.automationRate,
						mapped: [0, 0.25, 1, 10, 100, 1000].map((value) => ({
							value,
							mapped: item.map ? item.map(value) : value,
						})),
					})),
				})),
			};
		} finally {
			graph.dispose();
		}
	},
	configure(byteLength) {
		input = new Uint8Array(byteLength);
		output = undefined;
	},
	put(offset, base64) {
		const binary = atob(base64);
		for (let i = 0; i < binary.length; i++)
			input[offset + i] = binary.charCodeAt(i);
	},
	async render(request) {
		const data = model(request);
		const inputFrames = input.byteLength / 8;
		const frames =
			inputFrames + Math.ceil(data.tailSeconds * request.sampleRate);
		const context = new OfflineAudioContext(2, frames, request.sampleRate);
		const graph = await graphFor(context, data.chain, request.elapsed ?? 0);
		const events = [];
		for (const { target, targets } of targetsOf(graph))
			targets.forEach((item, index) => {
				item.param = recordParam(item.param, target, index, events);
			});
		try {
			const scheduled = scheduleChainAutomation(
				data.automation,
				data.chain,
				graph.nodes,
				{
					scheduledAt: request.scheduledAt ?? 0,
					elapsed: request.elapsed ?? 0,
					rate: request.rate ?? 1,
				},
				graph.presets,
			);
			const buffer = context.createBuffer(2, inputFrames, request.sampleRate),
				view = new DataView(input.buffer);
			for (let frame = 0; frame < inputFrames; frame++) {
				buffer.getChannelData(0)[frame] = view.getFloat32(frame * 8, true);
				buffer.getChannelData(1)[frame] = view.getFloat32(frame * 8 + 4, true);
			}
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(graph.input);
			graph.output.connect(context.destination);
			source.start(0);
			output = await context.startRendering();
			return {
				...data,
				frames: output.length,
				events,
				scheduledTargetCount: scheduled.length,
			};
		} finally {
			graph.dispose();
			input = undefined;
		}
	},
	read(offset, count) {
		if (
			!output ||
			offset % 8 ||
			count % 8 ||
			count > 65536 ||
			offset + count > output.length * 8
		)
			throw Error("Invalid FX automation oracle transfer");
		const bytes = new Uint8Array(count),
			view = new DataView(bytes.buffer);
		for (let byte = 0; byte < count; byte += 8) {
			const frame = (offset + byte) / 8;
			view.setFloat32(byte, output.getChannelData(0)[frame], true);
			view.setFloat32(byte + 4, output.getChannelData(1)[frame], true);
		}
		let binary = "";
		for (let byte = 0; byte < count; byte += 8192)
			binary += String.fromCharCode(
				...bytes.subarray(byte, Math.min(byte + 8192, count)),
			);
		return btoa(binary);
	},
};

import { createParticlePageRuntime } from "./particle-browser-runtime";
import { particlePageErrorMessage } from "./particle-browser-error";
import {
	PARTICLE_CONFIG_NAME,
	PARTICLE_REPLY_TAG,
	PARTICLE_REQUEST_TAG,
	PARTICLE_CLEANUP_REQUEST_TAG,
	PARTICLE_CLEANUP_ACK_TAG,
	PARTICLE_CHECK_REQUEST_TAG,
	PARTICLE_CHECK_ACK_TAG,
	type ParticlePageConfig,
} from "./particle-page-contract";

declare const frame: unknown;
const outer = parent;
const post = outer.postMessage.bind(outer);
const stopMessage = Function.prototype.call.bind(
	Event.prototype.stopImmediatePropagation,
);
const page = window as unknown as Record<string, unknown>;
const runtime = createParticlePageRuntime(
	page[PARTICLE_CONFIG_NAME] as ParticlePageConfig,
	frame,
	(payload) => post({ tag: PARTICLE_REQUEST_TAG, payload }, "*"),
);
let claimed = false;
Object.defineProperty(window, "__rocutClaimParticleRuntime", {
	value: () => {
		if (claimed) throw Error("Particle frame driver already claimed");
		claimed = true;
		return runtime;
	},
});
const reply = (tag: string, id: string, error?: unknown) =>
	post(
		{
			tag,
			id,
			...(error === undefined
				? { ok: true }
				: { error: particlePageErrorMessage(error) }),
		},
		"*",
	);
addEventListener(
	"message",
	(event) => {
		if (event.source !== outer) return;
		const data = event.data;
		if (
			![
				PARTICLE_REPLY_TAG,
				PARTICLE_CLEANUP_REQUEST_TAG,
				PARTICLE_CHECK_REQUEST_TAG,
			].includes(data?.tag)
		)
			return;
		// Capture listener is installed before authored scripts. Keep control ids
		// private so an author cannot forge an acknowledgement before disposal ends.
		stopMessage(event);
		if (data?.tag === PARTICLE_REPLY_TAG) {
			if (typeof data.reply === "string") runtime.receive(data.reply);
			else runtime.receive("");
		} else if (
			data?.tag === PARTICLE_CLEANUP_REQUEST_TAG &&
			typeof data.id === "string"
		) {
			void runtime.cleanup().then(
				() => reply(PARTICLE_CLEANUP_ACK_TAG, data.id),
				(error) => reply(PARTICLE_CLEANUP_ACK_TAG, data.id, error),
			);
		} else if (
			data?.tag === PARTICLE_CHECK_REQUEST_TAG &&
			typeof data.id === "string"
		) {
			void runtime.check().then(
				() => reply(PARTICLE_CHECK_ACK_TAG, data.id),
				(error) => reply(PARTICLE_CHECK_ACK_TAG, data.id, error),
			);
		}
	},
	true,
);
addEventListener(
	"pagehide",
	() => {
		void runtime.cleanup().catch(() => {});
	},
	{ once: true },
);

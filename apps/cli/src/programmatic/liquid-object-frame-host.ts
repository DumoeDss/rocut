import { createLiquidObjectWorker } from "./liquid-object-worker";
import { createThreeLiquidObjectTransport } from "./engines/three-liquid-object-transport";
import type { LiquidTransportFrame } from "./engines/three-liquid-object-transport-publication";
import { attachLiquidObjectBroker } from "./liquid-object-broker";
import type { ParticleBrowser } from "./particle-broker";
import type { ParticleSamplerIdentity } from "./particle-sampler-identity";

export async function attachLiquidObjectFrame(options: {
	browser: ParticleBrowser;
	session: string;
	executionContextId: number;
	frame: LiquidTransportFrame;
	expectedIdentity: ParticleSamplerIdentity;
	signal: AbortSignal;
}) {
	const frameJson = JSON.stringify(options.frame);
	const worker = await createLiquidObjectWorker({
		frameJson,
		signal: options.signal,
		expectedIdentity: options.expectedIdentity,
		bootstrapTimeoutMs: 5000,
	});
	let transport:
		| ReturnType<typeof createThreeLiquidObjectTransport>
		| undefined;
	try {
		transport = createThreeLiquidObjectTransport({
			frameJson,
			policyJson: worker.policyJson,
			admission: worker.admission,
			evaluate: worker.evaluate,
			signal: options.signal,
		});
		const broker = await attachLiquidObjectBroker({ ...options, transport });
		return Object.freeze({
			...broker,
			policy: worker.policy,
			policyJson: worker.policyJson,
			policyHash: worker.policyHash,
			publishedPolicyHash: worker.publishedPolicyHash,
			identity: worker.identity,
		});
	} catch (error) {
		try {
			if (transport) await transport.dispose();
			else await worker.terminate();
		} catch (cleanup) {
			throw new AggregateError(
				[error, cleanup],
				"Liquid frame initialization and cleanup failed",
			);
		}
		throw error;
	}
}

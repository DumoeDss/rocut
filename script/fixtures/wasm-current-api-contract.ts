// Reviewed additive API signatures. Deliberately explicit: never generated at gate runtime.
// JsValue adapters retain their generated any boundary; this is not a typed admission claim.
import * as wasm from "opencut-wasm";
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
type Assert<T extends true> = T;
declare namespace Expected {
	export interface LiquidObjectTransportOwner {
		free(): void;
		[Symbol.dispose](): void;
		command(input: any): string;
	}
	export interface MvHeartOwner {
		free(): void;
		[Symbol.dispose](): void;
		cancel(session: number): boolean;

		diagnosticJson(): string;
		dispose(): void;
		frameJson(session: number, metadata: string): string;
		imageBytes(session: number, index: number): Uint8Array;
		manifestJson(session: number): string;

		prepare(metadata: string, encoded: Uint8Array, rgba: Uint8Array): number;
		prepareSky(metadata: string, encoded: Uint8Array, rgba: Uint8Array): number;
	}
	export interface MvImagePreprocessOwner {
		free(): void;
		[Symbol.dispose](): void;
		admit(bytes: number): void;
		begin(binding: any, rgba: Uint8Array, bytes: number): bigint;
		dispose(id: bigint): void;
		key(binding: any): string;

		request(binding: any): any;
		step(id: bigint, max_pixels: number): boolean;
		take(id: bigint, binding: any): Uint8Array;
	}
	export interface MvJzOwner {
		free(): void;
		[Symbol.dispose](): void;
		checkText(session: number, font_id: string, text: string): void;
		dispose(): void;
		finishFrame(session: number, serial: number): void;
		frame(session: number, request: string): string;

		prepare(metadata: string, bytes: Uint8Array): number;
		preparedJson(session: number): string;
		release(session: number): void;
	}
	export interface MvLutAtlasOwner {
		free(): void;
		[Symbol.dispose](): void;
		bindRow(id: number, alias: any, rgba: Uint8Array): any;
		clear(): void;
		dispose(id: number): void;

		prepare(metadata: any, bytes: Uint8Array): any;
		resolveParameters(id: number, parameters: any): any;
		rowPixels(id: number, alias: any): Uint8Array;
		sample(id: number, alias: any): any;
	}
	export interface MvMemoriesOutput {
		free(): void;
		[Symbol.dispose](): void;
		bytes(index: number): Uint8Array;
		json(): string;
	}
	export interface MvMemoriesOwner {
		free(): void;
		[Symbol.dispose](): void;
		acceptStage(
			session: number,
			stage: MvMemoriesStage,
			metadata: string,
			rgba: Uint8Array,
		): MvMemoriesOutput | undefined;
		beginStage(session: number, kind: string, slot: number): MvMemoriesStage;
		cancel(session: number): boolean;
		cancelStage(session: number, stage: MvMemoriesStage): void;

		diagnosticJson(): string;
		dispose(): void;
		finishFrame(session: number, output: MvMemoriesOutput): void;
		frame(session: number, input: string): MvMemoriesOutput;

		prepare(metadata: string, encoded: Uint8Array, rgba: Uint8Array): number;
		prepareReserved(
			ticket: MvMemoriesPreparation,
			metadata: string,
			encoded: Uint8Array,
			rgba: Uint8Array,
		): number;
		preparedBytes(session: number, index: number): Uint8Array;
		preparedJson(session: number): string;
		reserve(bytes: number): MvMemoriesPreparation;
	}
	export interface MvMemoriesPreparation {
		free(): void;
		[Symbol.dispose](): void;
	}
	export interface MvMemoriesStage {
		free(): void;
		[Symbol.dispose](): void;
		bytes(index: number): Uint8Array;
		json(): string;
	}
	export interface MvNightOwner {
		free(): void;
		[Symbol.dispose](): void;
		bindDecoded(id: number, facts: any): void;
		bindLutRow(rgba: Uint8Array): any;
		bindReflection(id: number, rgba: Uint8Array): any;
		clear(): void;
		diagnostic(): any;
		dispose(id: number): void;
		evaluate(id: number, sample: any): any;

		preflight(metadata: any, length: number): void;
		prepare(metadata: any, bytes: Uint8Array): any;
		prepareLut(metadata: any, bytes: Uint8Array): any;
		releaseFrame(id: number): void;
	}
}
type LiquidObjectTransportOwnerExact = Assert<
	Equal<wasm.LiquidObjectTransportOwner, Expected.LiquidObjectTransportOwner>
>;
type LiquidObjectTransportOwnerConstructorExact = Assert<
	Equal<
		ConstructorParameters<typeof wasm.LiquidObjectTransportOwner>,
		Parameters<(frame: any) => void>
	>
>;
type MvHeartOwnerExact = Assert<
	Equal<wasm.MvHeartOwner, Expected.MvHeartOwner>
>;
type MvHeartOwnercapabilityJsonExact = Assert<
	Equal<typeof wasm.MvHeartOwner.capabilityJson, () => string>
>;
type MvHeartOwnerConstructorExact = Assert<
	Equal<ConstructorParameters<typeof wasm.MvHeartOwner>, Parameters<() => void>>
>;
type MvImagePreprocessOwnerExact = Assert<
	Equal<wasm.MvImagePreprocessOwner, Expected.MvImagePreprocessOwner>
>;
type MvImagePreprocessOwnerConstructorExact = Assert<
	Equal<
		ConstructorParameters<typeof wasm.MvImagePreprocessOwner>,
		Parameters<() => void>
	>
>;
type MvJzOwnerExact = Assert<Equal<wasm.MvJzOwner, Expected.MvJzOwner>>;
type MvJzOwnerConstructorExact = Assert<
	Equal<ConstructorParameters<typeof wasm.MvJzOwner>, Parameters<() => void>>
>;
type MvLutAtlasOwnerExact = Assert<
	Equal<wasm.MvLutAtlasOwner, Expected.MvLutAtlasOwner>
>;
type MvLutAtlasOwnerConstructorExact = Assert<
	Equal<
		ConstructorParameters<typeof wasm.MvLutAtlasOwner>,
		Parameters<() => void>
	>
>;
type MvMemoriesOutputExact = Assert<
	Equal<wasm.MvMemoriesOutput, Expected.MvMemoriesOutput>
>;
type MvMemoriesOwnerExact = Assert<
	Equal<wasm.MvMemoriesOwner, Expected.MvMemoriesOwner>
>;
type MvMemoriesOwnercapabilityJsonExact = Assert<
	Equal<typeof wasm.MvMemoriesOwner.capabilityJson, () => string>
>;
type MvMemoriesOwnermeasurementRequestsJsonExact = Assert<
	Equal<
		typeof wasm.MvMemoriesOwner.measurementRequestsJson,
		(args: string) => string
	>
>;
type MvMemoriesOwnersourceAdmissionJsonExact = Assert<
	Equal<
		typeof wasm.MvMemoriesOwner.sourceAdmissionJson,
		(args: string, resource: string, bytes: Uint8Array) => string
	>
>;
type MvMemoriesOwnersourceRequestsJsonExact = Assert<
	Equal<
		typeof wasm.MvMemoriesOwner.sourceRequestsJson,
		(args: string, resources: string) => string
	>
>;
type MvMemoriesOwnerConstructorExact = Assert<
	Equal<
		ConstructorParameters<typeof wasm.MvMemoriesOwner>,
		Parameters<() => void>
	>
>;
type MvMemoriesPreparationExact = Assert<
	Equal<wasm.MvMemoriesPreparation, Expected.MvMemoriesPreparation>
>;
type MvMemoriesStageExact = Assert<
	Equal<wasm.MvMemoriesStage, Expected.MvMemoriesStage>
>;
type MvNightOwnerExact = Assert<
	Equal<wasm.MvNightOwner, Expected.MvNightOwner>
>;
type MvNightOwnerConstructorExact = Assert<
	Equal<ConstructorParameters<typeof wasm.MvNightOwner>, Parameters<() => void>>
>;
type encodeRemotionProducedAudioWavExact = Assert<
	Equal<
		typeof wasm.encodeRemotionProducedAudioWav,
		(input: Uint8Array) => Uint8Array
	>
>;
type evaluateLiquidObjectFrameJsonExact = Assert<
	Equal<typeof wasm.evaluateLiquidObjectFrameJson, (input: string) => string>
>;
type inspectScalarAnimationDomainsJsonExact = Assert<
	Equal<
		typeof wasm.inspectScalarAnimationDomainsJson,
		(input: string) => string
	>
>;
type liquidObjectTransportPolicyJsonExact = Assert<
	Equal<typeof wasm.liquidObjectTransportPolicyJson, () => string>
>;
type mixRemotionProducedAudioPcmExact = Assert<
	Equal<
		typeof wasm.mixRemotionProducedAudioPcm,
		(input: Uint8Array) => Uint8Array
	>
>;
type nativeTransitionStyleValidateJsonExact = Assert<
	Equal<
		typeof wasm.nativeTransitionStyleValidateJson,
		(input: string) => string
	>
>;
type prepareRemotionInlineAudioSourcesJsonExact = Assert<
	Equal<
		typeof wasm.prepareRemotionInlineAudioSourcesJson,
		(input: string) => Uint8Array
	>
>;
type resolveEffectLayerParamsJsonExact = Assert<
	Equal<typeof wasm.resolveEffectLayerParamsJson, (input: string) => string>
>;
type resolveGlassObjectParamsJsonExact = Assert<
	Equal<typeof wasm.resolveGlassObjectParamsJson, (input: string) => string>
>;
type resolveInkObjectParamsJsonExact = Assert<
	Equal<typeof wasm.resolveInkObjectParamsJson, (input: string) => string>
>;
type resolveLiquidObjectParamsJsonExact = Assert<
	Equal<typeof wasm.resolveLiquidObjectParamsJson, (input: string) => string>
>;
type resolveProgrammaticFrameTunnelJsonExact = Assert<
	Equal<
		typeof wasm.resolveProgrammaticFrameTunnelJson,
		(input: string, layout: string, bytes: Uint8Array) => string
	>
>;
type resolveRemotionProducedAssetsJsonExact = Assert<
	Equal<
		typeof wasm.resolveRemotionProducedAssetsJson,
		(input: string) => string
	>
>;
type resolveRemotionProducedFramesJsonExact = Assert<
	Equal<
		typeof wasm.resolveRemotionProducedFramesJson,
		(input: string) => string
	>
>;
type sampleScalarAnimationBatchJsonExact = Assert<
	Equal<typeof wasm.sampleScalarAnimationBatchJson, (input: string) => string>
>;
type validateMasterEffectsJsonExact = Assert<
	Equal<typeof wasm.validateMasterEffectsJson, (input: string) => string>
>;
// Binary versus JSON transport must not silently collapse.
// @ts-expect-error Produced PCM is binary, never a JSON/string envelope.
wasm.mixRemotionProducedAudioPcm("{}");
// @ts-expect-error Tunnel layout requires the independently admitted font byte snapshot.
wasm.resolveProgrammaticFrameTunnelJson("{}", "{}");
// @ts-expect-error Memories stages are owner-created objects, not external handles.
new wasm.MvMemoriesStage();

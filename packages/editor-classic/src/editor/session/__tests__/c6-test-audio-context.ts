/*
 * A Host-scoped Web Audio fixture for C6 session tests. The protected
 * in-memory port correctly exposes no ambient AudioContext; tests that need
 * decoding install this fixture through the Host runtime-resource seam.
 */

/* eslint-disable opencut/prefer-object-params -- Web Audio APIs use positional parameters. */
export class C6TestAudioBuffer implements AudioBuffer {
	readonly duration = 1;
	readonly length = 1;
	readonly numberOfChannels = 1;
	readonly sampleRate = 48_000;

	copyFromChannel(
		_destination: Float32Array<ArrayBuffer>,
		_channelNumber: number,
		_bufferOffset?: number,
	): void {}

	copyToChannel(
		_source: Float32Array<ArrayBuffer>,
		_channelNumber: number,
		_bufferOffset?: number,
	): void {}

	getChannelData(_channel: number): Float32Array<ArrayBuffer> {
		return new Float32Array(1);
	}
}

export class C6TestAudioContext extends EventTarget implements AudioContext {
	readonly baseLatency = 0;
	readonly outputLatency = 0;
	readonly currentTime = 0;
	readonly sampleRate = 48_000;
	state: AudioContextState = "running";
	onstatechange: ((this: BaseAudioContext, ev: Event) => void) | null = null;

	private unavailable<T>(): T {
		throw new Error("The session audio fixture does not implement this API.");
	}

	get audioWorklet(): AudioWorklet {
		return this.unavailable();
	}

	get destination(): AudioDestinationNode {
		return this.unavailable();
	}

	get listener(): AudioListener {
		return this.unavailable();
	}

	createAnalyser(): AnalyserNode {
		return this.unavailable();
	}

	createBiquadFilter(): BiquadFilterNode {
		return this.unavailable();
	}

	createBuffer(
		_numberOfChannels: number,
		_length: number,
		_sampleRate: number,
	): AudioBuffer {
		return this.unavailable();
	}

	createBufferSource(): AudioBufferSourceNode {
		return this.unavailable();
	}

	createChannelMerger(_numberOfInputs?: number): ChannelMergerNode {
		return this.unavailable();
	}

	createChannelSplitter(_numberOfOutputs?: number): ChannelSplitterNode {
		return this.unavailable();
	}

	createConstantSource(): ConstantSourceNode {
		return this.unavailable();
	}

	createConvolver(): ConvolverNode {
		return this.unavailable();
	}

	createDelay(_maxDelayTime?: number): DelayNode {
		return this.unavailable();
	}

	createDynamicsCompressor(): DynamicsCompressorNode {
		return this.unavailable();
	}

	createGain(): GainNode {
		return this.unavailable();
	}

	createIIRFilter(_feedforward: number[], _feedback: number[]): IIRFilterNode {
		return this.unavailable();
	}

	createOscillator(): OscillatorNode {
		return this.unavailable();
	}

	createPanner(): PannerNode {
		return this.unavailable();
	}

	createPeriodicWave(
		_real: number[] | Float32Array,
		_imag: number[] | Float32Array,
		_constraints?: PeriodicWaveConstraints,
	): PeriodicWave {
		return this.unavailable();
	}

	createScriptProcessor(
		_bufferSize?: number,
		_numberOfInputChannels?: number,
		_numberOfOutputChannels?: number,
	): ScriptProcessorNode {
		return this.unavailable();
	}

	createStereoPanner(): StereoPannerNode {
		return this.unavailable();
	}

	createWaveShaper(): WaveShaperNode {
		return this.unavailable();
	}

	createMediaElementSource(
		_mediaElement: HTMLMediaElement,
	): MediaElementAudioSourceNode {
		return this.unavailable();
	}

	createMediaStreamDestination(): MediaStreamAudioDestinationNode {
		return this.unavailable();
	}

	createMediaStreamSource(
		_mediaStream: MediaStream,
	): MediaStreamAudioSourceNode {
		return this.unavailable();
	}

	getOutputTimestamp(): AudioTimestamp {
		return { contextTime: this.currentTime, performanceTime: 0 };
	}

	async close(): Promise<void> {
		this.state = "closed";
	}

	async decodeAudioData(
		_audioData: ArrayBuffer,
		_successCallback?: DecodeSuccessCallback | null,
		_errorCallback?: DecodeErrorCallback | null,
	): Promise<AudioBuffer> {
		return new C6TestAudioBuffer();
	}

	async resume(): Promise<void> {
		this.state = "running";
	}

	async suspend(): Promise<void> {
		this.state = "suspended";
	}
}
/* eslint-enable opencut/prefer-object-params */

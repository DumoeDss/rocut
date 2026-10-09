import type { EncodedPacket, EncodedVideoPacketSource } from "mediabunny";

type PendingPacket = {
	packet: EncodedPacket;
	metadata?: EncodedVideoChunkMetadata;
};

/** Owns only adapter-side buffering, not the muxer's cross-track chunk queues. */
export class Vp9QuantizerWrites {
	private readonly queue: PendingPacket[] = [];
	private running = false;
	private stopped = false;
	count = 0;
	bytes = 0;

	private readonly source: EncodedVideoPacketSource;
	private readonly maxBytes: number;
	private readonly fail: (error: unknown) => void;
	private readonly changed: () => void;
	constructor({
		source,
		maxBytes,
		fail,
		changed,
	}: {
		source: EncodedVideoPacketSource;
		maxBytes: number;
		fail: (error: unknown) => void;
		changed: () => void;
	}) {
		this.source = source;
		this.maxBytes = maxBytes;
		this.fail = fail;
		this.changed = changed;
	}

	add({ packet, metadata }: PendingPacket): void {
		if (this.stopped) return;
		if (packet.data.byteLength > this.maxBytes - this.bytes)
			throw Error("VP9 pending packet byte limit exceeded.");
		this.count++;
		this.bytes += packet.data.byteLength;
		this.queue.push({ packet, metadata });
		void this.pump();
	}

	stop(): void {
		this.stopped = true;
		for (const { packet } of this.queue) {
			this.count--;
			this.bytes -= packet.data.byteLength;
		}
		this.queue.length = 0;
		this.changed();
	}

	private async pump(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			while (!this.stopped && this.queue.length) {
				const item = this.queue.shift()!;
				try {
					// Matroska 1.48.1 returns when another track has no available
					// chunk; this promise waits on the writer, not a future audio add.
					await this.source.add(item.packet, item.metadata);
				} catch (error) {
					this.fail(error);
				} finally {
					this.count--;
					this.bytes -= item.packet.data.byteLength;
					this.changed();
				}
			}
		} finally {
			this.running = false;
		}
	}
}

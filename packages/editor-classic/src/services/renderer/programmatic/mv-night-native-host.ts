import type { MvNightPreparationRequest } from "../../../../../editor-contracts/src/mv-night";
import type { MvRecipePlan } from "../../../../../editor-contracts/src/mv-recipe-plan";
import type { HeartNativeImageInput } from "./mv-heart-native-pixels";
import { key } from "./mv-heart-owner-provider-protocol";
import { prepareNightNative, type NightNativeSession, type NightBinding } from "./mv-night-native";
import { nightNativeRequests, type NightNativeFramePacket } from "./mv-night-native-transport";

/** The host renders original native font/reflection/P4 passes before transport.
 * Each occurrence gets its own Rust owner. Once the final raster copy exists,
 * native surfaces are destroyed before its frame lease is released; the root
 * caller's joint raster budget owns the transferred copy until realm disposal. */
export async function prepareNightNativeFrames({ plan, input, signal }: {
    plan: MvRecipePlan; input: HeartNativeImageInput; signal?: AbortSignal;
}) {
    const nodes = nightNativeRequests(plan.root);
    if (!nodes.length) return undefined;
    const reservation = nodes[0]!.request.host;
    if (!reservation || nodes.some(node => key(node.request.host) !== key(reservation)) ||
        !Object.values(reservation).every(value => Number.isSafeInteger(value) && value >= 0) ||
        reservation.retainedBitmapBytes !== nodes.length * 1920 * 1080 * 4 ||
        reservation.preparationPeakBytes < reservation.retainedBitmapBytes || reservation.rasterByteLimit < 1920 * 1080 * 4)
        throw Error("Night native host requires consistent Rust complete-graph reservation");
    const sessions: NightNativeSession[] = [], transfers: ImageBitmap[] = [], lutImages: ImageBitmap[] = [];
    const packets: NightNativeFramePacket[] = [];
    let disposed = false;
    const dispose = async () => {
        if (disposed) return;
        disposed = true;
        for (const bitmap of transfers) bitmap.close();
        for (const session of sessions) session.dispose();
        for (const bitmap of lutImages) bitmap.close();
    };
    const source = (resource: MvNightPreparationRequest["physicalResources"][number]) => {
        const found = input.resources.filter(item => key(item.resource) === key(resource));
        if (found.length !== 1 || !(found[0]!.body instanceof ArrayBuffer) || found[0]!.body.byteLength !== resource.byteLength)
            throw Error("Night native requires exact canonical binary source");
        return { resource, bytes: found[0]!.body };
    };
    const admitted = (resource: MvNightPreparationRequest["physicalResources"][number]) => {
        const facts = input.imageAdmissions.filter(item => key(item.resource) === key(resource));
        const limits = input.imageDecodeLimits;
        if (facts.length !== 1 || !limits || ![facts[0]!.width, facts[0]!.height, facts[0]!.decodedBytes].every(Number.isSafeInteger) ||
            facts[0]!.width < 1 || facts[0]!.height < 1 || facts[0]!.width > limits.maxDimension || facts[0]!.height > limits.maxDimension ||
            facts[0]!.decodedBytes !== facts[0]!.width * facts[0]!.height * 4 || facts[0]!.decodedBytes > limits.maxDecodedBytes)
            throw Error("Night actual decode needs canonical bounded admission");
        return facts[0]!;
    };
    try {
        const occurrences = new Set<number>();
        for (const node of nodes) {
            signal?.throwIfAborted();
            const request = node.request;
            if (!Number.isSafeInteger(request.occurrenceId) || request.occurrenceId < 1 || occurrences.has(request.occurrenceId))
                throw Error("Night duplicate or unissued traversal occurrence");
            occurrences.add(request.occurrenceId);
            const metadata: { binding: NightBinding; beats: number[] } = JSON.parse(request.metadata);
            for (const resource of request.physicalResources) if (resource.kind === "image") admitted(resource);
            const session = await prepareNightNative({ binding: metadata.binding, beats: metadata.beats,
                resources: request.physicalResources.map(source), fontInstances: request.fontInstances });
            sessions.push(session);
            signal?.throwIfAborted();
            for (const image of session.images) {
                const resource = request.physicalResources.find(r => r.id === image.resourceId);
                if (!resource) throw Error("Night native decoded unexpected resource");
                const fact = admitted(resource);
                if (fact.width !== image.width || fact.height !== image.height) throw Error("Night native dimensions changed after admission");
            }
            if (request.requiresOriginalP4Post) {
                if (!request.lutAtlas) throw Error("Night Train original P4 atlas missing");
                const sources = request.lutResources.map(source);
                const images = [];
                for (const item of sources) if (item.resource.kind === "image") {
                    const fact = admitted(item.resource);
                    const image = await createImageBitmap(new Blob([item.bytes], { type: item.resource.mimeType }));
                    lutImages.push(image);
                    signal?.throwIfAborted();
                    if (image.width !== fact.width || image.height !== fact.height) throw Error("Night P4 actual image dimensions mismatch");
                    images.push({ resourceId: item.resource.id, sha256: item.resource.sha256, width: image.width, height: image.height, image });
                }
                let length = 0;
                const byteLayout = sources.map(item => { const part = { resourceId: item.resource.id, offset: length, length: item.bytes.byteLength }; length += part.length; return part; });
                // Existing Rust owner preflight validates the actual full LUT packet.
                const bytes = new Uint8Array(length);
                sources.forEach((item, i) => bytes.set(new Uint8Array(item.bytes), byteLayout[i]!.offset));
                session.bindLut({ metadata: JSON.stringify({ settings: request.lutAtlas, resources: request.lutResources, byteLayout,
                    decodedImages: images.map(({ resourceId, width, height }) => ({ resourceId, width, height })), requiredAliases: ["P4"] }), bytes, images });
            }
            const output = await session.render({ songTicks: request.songTicks, shotStartTicks: request.shotStartTicks, shotEndTicks: request.shotEndTicks });
            signal?.throwIfAborted();
            const bitmap = await createImageBitmap(output.canvas);
            transfers.push(bitmap);
            output.release();
            session.dispose();
            for (const image of lutImages.splice(0)) image.close();
            signal?.throwIfAborted();
            packets.push({ requestKey: key(node), frame: output.frame, bitmap });
        }
        return { packets, transfers, rasterByteLimit: reservation.rasterByteLimit, dispose };
    } catch (error) { await dispose(); throw error; }
}

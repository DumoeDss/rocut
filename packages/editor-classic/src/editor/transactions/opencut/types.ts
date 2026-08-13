import type { TransactionEngineDocument } from "@opencut/editor-contracts/engine";
import type { ProjectRecord } from "@opencut/editor-ports";
import type { MediaAsset } from "../../../media/types";
import type { TProject } from "../../../project/types";

export {
	COMMAND_ROUTING_CLASSES,
	type CommandRoutingClass,
} from "../../../commands/base-command";

declare const commitTokenBrand: unique symbol;

export type OpenCutCommitToken = string & {
	readonly [commitTokenBrand]: true;
};

export interface OpenCutAssetCatalogEntry {
	readonly id: string;
	readonly name: string;
	readonly type: MediaAsset["type"];
	readonly duration?: number;
	readonly width?: number;
	readonly height?: number;
}

export interface OpenCutProjectDraft {
	project: TProject;
	assetCatalog: OpenCutAssetCatalogEntry[];
}

export interface StagedOpenCutCandidate {
	readonly token: OpenCutCommitToken;
	readonly baseRevision: number;
	readonly previousRecordDigest: string;
	readonly draft: OpenCutProjectDraft;
	readonly projectedDocument: TransactionEngineDocument;
}

export interface EncodedOpenCutPublicationReceipt {
	readonly token: OpenCutCommitToken | null;
	readonly record: ProjectRecord;
	readonly draft: OpenCutProjectDraft;
}

export function assetCatalogFromMedia(
	assets: readonly MediaAsset[],
): OpenCutAssetCatalogEntry[] {
	return assets.map((asset) => ({
		id: asset.id,
		name: asset.name,
		type: asset.type,
		...(asset.duration !== undefined && { duration: asset.duration }),
		...(asset.width !== undefined && { width: asset.width }),
		...(asset.height !== undefined && { height: asset.height }),
	}));
}

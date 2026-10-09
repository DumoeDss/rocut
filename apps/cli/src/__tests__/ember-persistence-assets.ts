import type { ProgrammaticResource } from "@opencut/editor-contracts";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { imageSequencePng } from "../../../../script/fixtures/image-sequence-png";
import {
	emberAnalysis,
	emberAudioFacts,
} from "../../../../script/fixtures/mv-ember-audio";

type EmberAsset = {
	id: string;
	mimeType: string;
	bytes: Uint8Array;
} & (
	| { kind: "font"; font: NonNullable<ProgrammaticResource["font"]> }
	| { kind: "image" | "analysis"; font?: never }
);

export async function writeEmberAssets(author: string) {
	const font = await readFile(
		resolve(
			import.meta.dir,
			"../../../../apps/web/public/motion-text/fonts/dot-gothic-16-regular.ttf",
		),
	);
	const analysis = await emberAnalysis(emberAudioFacts({ vocal: true }));
	const assets: EmberAsset[] = [
		{
			id: "ember-dot.ttf",
			kind: "font",
			mimeType: "font/ttf",
			font: { family: "Ember Fixture Dot", weight: 400, style: "normal" },
			bytes: font,
		},
		{
			id: "wide.png",
			kind: "image",
			mimeType: "image/png",
			bytes: imageSequencePng(17),
		},
		{
			id: "portrait.png",
			kind: "image",
			mimeType: "image/png",
			bytes: imageSequencePng(97),
		},
		{
			id: "ember-analysis.json",
			kind: "analysis",
			mimeType: "application/json",
			bytes: new Uint8Array(analysis.body),
		},
	];
	for (const asset of assets)
		await writeFile(join(author, asset.id), asset.bytes, { flag: "wx" });
	// Image names are stable shared fixture identities, not a claim that these tiny
	// persistence-only PNGs exercise cover geometry. Real browser assets do that.
	return assets;
}

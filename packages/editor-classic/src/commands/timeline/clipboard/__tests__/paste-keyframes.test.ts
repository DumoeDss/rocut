import { describe, expect, test } from "bun:test";
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The focused command test supplies only the editor collaborators the empty-paste path reads. */
import type { KeyframeClipboardItem } from "../../../../clipboard";
import { PasteKeyframesCommand } from "../paste-keyframes";

describe("PasteKeyframesCommand admission", () => {
	test("empty clipboard pastes nothing and touches no tracks", () => {
		const saved: unknown[] = [];
		const editor = {
			scenes: { getActiveScene: () => ({ tracks: [] }) },
			timeline: { updateTracks: (tracks: unknown) => saved.push(tracks) },
		};
		const items: KeyframeClipboardItem[] = [];
		const command = new PasteKeyframesCommand({
			trackId: "t1",
			elementId: "g1",
			time: 0,
			clipboardItems: items,
		});
		expect(command.execute({ editor: editor as never })).toBeUndefined();
		expect(saved).toHaveLength(0);
	});
});

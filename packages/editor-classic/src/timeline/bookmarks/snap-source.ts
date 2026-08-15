import type { Bookmark } from "..";
import type { SnapPoint } from "../snapping";
import type { MediaTime } from "../../wasm";

export function getBookmarkSnapPoints({
	bookmarks,
	excludeBookmarkTime,
}: {
	bookmarks: Bookmark[];
	excludeBookmarkTime?: MediaTime;
}): SnapPoint[] {
	return bookmarks.flatMap((bookmark) => {
		if (excludeBookmarkTime != null && bookmark.time === excludeBookmarkTime) {
			return [];
		}

		return [
			{ time: bookmark.time, type: "bookmark" satisfies SnapPoint["type"] },
		];
	});
}

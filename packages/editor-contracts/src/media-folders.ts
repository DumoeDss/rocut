export interface MediaFolder {
	readonly id: string;
	readonly name: string;
	readonly parentId?: string;
}

/** Stored inside one project; unassigned assets belong to the root. */
export interface MediaFolderState {
	readonly projectId: string;
	readonly folders: readonly MediaFolder[];
	readonly assignments: readonly {
		readonly assetId: string;
		readonly folderId: string;
	}[];
}

export type MediaFolderMutation =
	| {
			readonly kind: "create";
			readonly id: string;
			readonly name: string;
			readonly parentId?: string;
	  }
	| { readonly kind: "rename"; readonly id: string; readonly name: string }
	| {
			readonly kind: "move-folder";
			readonly id: string;
			readonly parentId?: string;
	  }
	| {
			readonly kind: "move-assets";
			readonly assetIds: readonly string[];
			readonly folderId?: string;
	  }
	| { readonly kind: "dissolve"; readonly id: string };

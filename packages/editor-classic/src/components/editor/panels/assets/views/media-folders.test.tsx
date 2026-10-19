import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.EDITOR_FOLDER_UI_TEST !== "1") {
	test("folder controls submit native operations and expose capability failures", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, EDITOR_FOLDER_UI_TEST: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	const React = await import("react");
	let state: unknown[] = [],
		index = 0;
	mock.module("react", () => ({
		...React,
		useState(initial: unknown) {
			const slot = index++;
			if (!(slot in state)) state[slot] = initial;
			return [
				state[slot],
				(value: unknown) => {
					state[slot] = value;
				},
			];
		},
	}));
	let available = true,
		fail = false;
	const operations: unknown[] = [];
	const folders = [
		{ id: "parent", name: "Parent" },
		{ id: "child", name: "Child", parentId: "parent" },
	];
	const editor = {
		media: {
			getFolders: () => folders,
			isFolderEditingAvailable: () => available,
			async mutateFolders(operation: unknown) {
				if (fail) throw Error("disk unavailable");
				operations.push(operation);
			},
		},
	};
	mock.module("../../../../../editor/use-editor", () => ({
		useEditor: (select: (core: typeof editor) => unknown) => select(editor),
		useEditorInstance: () => editor,
	}));
	mock.module("../../../../../selection", () => ({
		useSelection: () => ({ selectedIds: ["media-a", "media-b"] }),
	}));
	const { getEditorMessages } = await import("../../../../../editor/host/editor-messages");
	mock.module("../../../../../editor/host/editor-host-context", () => ({
		useEditorMessages: () => getEditorMessages("zh-CN"),
	}));
	const { MediaFolders, MoveMediaSelection, folderLabel } =
		await import("./media-folders");
	function find(node: any, predicate: (item: any) => boolean): any {
		if (!node || typeof node !== "object") return undefined;
		if (predicate(node)) return node;
		for (const child of React.Children.toArray(node.props?.children)) {
			const found = find(child, predicate);
			if (found) return found;
		}
	}
	test("create subfolder, rename and dissolve preserve native operation boundaries", async () => {
		let active = "parent";
		const render = () => {
			index = 0;
			return MediaFolders({
				active,
				onSelect: (id) => {
					active = id;
				},
			});
		};
		let tree = render();
		find(
			tree,
			(item) => item.props?.["aria-label"] === "文件夹名称",
		).props.onChange({ target: { value: "New" } });
		tree = render();
		find(
			tree,
			(item) => item.props?.children === "新建子文件夹",
		).props.onClick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(operations[0]).toMatchObject({
			kind: "create",
			parentId: "parent",
			name: "New",
		});
		active = "child";
		tree = render();
		find(
			tree,
			(item) => item.props?.["aria-label"] === "文件夹名称",
		).props.onChange({ target: { value: "Renamed" } });
		tree = render();
		find(tree, (item) => item.props?.children === "重命名").props.onClick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(operations[1]).toEqual({
			kind: "rename",
			id: "child",
			name: "Renamed",
		});
		tree = render();
		find(tree, (item) => item.props?.children === "解散文件夹").props.onClick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(operations[2]).toEqual({ kind: "dissolve", id: "child" });
		expect(active).toBe("parent");
		expect(folderLabel({ folder: folders[1], folders })).toBe("Parent / Child");
	});
	test("move selection submits one native mutation; rejection is visible and unsupported editing is disabled", async () => {
		state = [];
		index = 0;
		let tree = MoveMediaSelection();
		find(
			tree,
			(item) => item.props?.["aria-label"] === "目标素材文件夹",
		).props.onChange({ target: { value: "child" } });
		index = 0;
		tree = MoveMediaSelection();
		await find(
			tree,
			(item) => typeof item.props?.onClick === "function",
		).props.onClick();
		expect(operations.at(-1)).toEqual({
			kind: "move-assets",
			assetIds: ["media-a", "media-b"],
			folderId: "child",
		});
		fail = true;
		index = 0;
		tree = MoveMediaSelection();
		await find(
			tree,
			(item) => typeof item.props?.onClick === "function",
		).props.onClick();
		index = 0;
		tree = MoveMediaSelection();
		expect(find(tree, (item) => item.props?.role === "alert")).toBeTruthy();
		available = false;
		state = [];
		index = 0;
		tree = MediaFolders({ active: "parent", onSelect() {} });
		expect(find(tree, (item) => item.props?.role === "status")).toBeTruthy();
		expect(
			find(tree, (item) => item.props?.["aria-label"] === "文件夹名称").props
				.disabled,
		).toBe(true);
	});
}

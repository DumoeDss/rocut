#!/usr/bin/env node
/**
 * Fail-closed ownership and physical-path checks for scratch-root replacement.
 *
 * The lifecycle deliberately renames an authenticated tree to a sibling before
 * recursive cleanup. Every rename/cleanup boundary revalidates the direct
 * parent's physical identity, the tree's device/inode identity, and the exact
 * marker payload. A copied marker or redirected path is residue to report, not
 * authority to delete.
 */
import { randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";

export const SCRATCH_MARKER_NAME = ".opencut-scratch-marker";
const MARKER_SCHEMA_VERSION = 1;
const MAX_MARKER_BYTES = 16 * 1024;

function samePath(left, right) {
	const rel = relative(resolve(left), resolve(right));
	return (
		rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && rel === ".")
	);
}

function identityOf(stat) {
	return {
		device: String(stat.dev),
		inode: String(stat.ino),
	};
}

function sameIdentity(left, right) {
	return left.device === right.device && left.inode === right.inode;
}

function inspectPlainDirectory(path, label) {
	if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
	const stat = lstatSync(path, { bigint: true });
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(`${label} is not a plain directory: ${path}`);
	}
	const physicalPath = realpathSync.native(path);
	if (!samePath(path, physicalPath)) {
		throw new Error(
			`${label} resolves through a redirected ancestor (${path} -> ${physicalPath})`,
		);
	}
	return {
		path: resolve(path),
		physicalPath,
		...identityOf(stat),
	};
}

function inspectMarkerFile(treePath) {
	const markerPath = join(treePath, SCRATCH_MARKER_NAME);
	if (!existsSync(markerPath)) {
		throw new Error(
			`pre-existing root has no ${SCRATCH_MARKER_NAME} marker — foreign root, refusing to touch it`,
		);
	}
	const stat = lstatSync(markerPath, { bigint: true });
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error(`${SCRATCH_MARKER_NAME} is not a plain file`);
	}
	if (stat.size > BigInt(MAX_MARKER_BYTES)) {
		throw new Error(`${SCRATCH_MARKER_NAME} exceeds ${MAX_MARKER_BYTES} bytes`);
	}
	let marker;
	try {
		marker = JSON.parse(readFileSync(markerPath, "utf8"));
	} catch (error) {
		throw new Error(
			`${SCRATCH_MARKER_NAME} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (marker === null || typeof marker !== "object" || Array.isArray(marker)) {
		throw new Error(`${SCRATCH_MARKER_NAME} must contain an object`);
	}
	return marker;
}

function validateMarker(args) {
	const marker = inspectMarkerFile(args.treePath);
	if (marker.schemaVersion !== MARKER_SCHEMA_VERSION) {
		throw new Error(
			`${SCRATCH_MARKER_NAME} schema mismatch (expected ${MARKER_SCHEMA_VERSION})`,
		);
	}
	if (marker.createdBy !== args.createdBy) {
		throw new Error(
			`${SCRATCH_MARKER_NAME} owner mismatch (expected ${args.createdBy})`,
		);
	}
	if (
		typeof marker.createdAt !== "string" ||
		Number.isNaN(Date.parse(marker.createdAt))
	) {
		throw new Error(`${SCRATCH_MARKER_NAME} has no valid createdAt timestamp`);
	}
	if (!samePath(marker.rootPath ?? "", args.originalRootPath)) {
		throw new Error(
			`${SCRATCH_MARKER_NAME} rootPath does not own this scratch root`,
		);
	}
	if (!samePath(marker.parentPhysicalPath ?? "", args.parent.physicalPath)) {
		throw new Error(`${SCRATCH_MARKER_NAME} parent identity does not match`);
	}
	if (
		marker.rootDevice !== (args.markerTreeIdentity ?? args.tree).device ||
		marker.rootInode !== (args.markerTreeIdentity ?? args.tree).inode
	) {
		throw new Error(`${SCRATCH_MARKER_NAME} tree identity does not match`);
	}
}

function captureOwnedTree(args) {
	const parent = inspectPlainDirectory(
		dirname(args.treePath),
		"scratch parent",
	);
	const tree = inspectPlainDirectory(args.treePath, "scratch root");
	validateMarker({
		treePath: args.treePath,
		originalRootPath: args.originalRootPath,
		createdBy: args.createdBy,
		parent,
		tree,
	});
	return { parent, tree };
}

function assertSamePhysicalDirectory(path, expected, label) {
	const actual = inspectPlainDirectory(path, label);
	if (
		!samePath(actual.physicalPath, expected.physicalPath) ||
		!sameIdentity(actual, expected)
	) {
		throw new Error(
			`${label} physical identity changed before destructive action`,
		);
	}
	return actual;
}

function revalidateOwnedTree(args) {
	const parent = assertSamePhysicalDirectory(
		dirname(args.treePath),
		args.capture.parent,
		"scratch parent",
	);
	const tree = assertSamePhysicalDirectory(
		args.treePath,
		args.capture.tree,
		"scratch root",
	);
	validateMarker({
		treePath: args.treePath,
		originalRootPath: args.originalRootPath,
		createdBy: args.createdBy,
		parent,
		tree,
		markerTreeIdentity: args.markerTreeIdentity,
	});
}

function captureMovedOwnedTree(args) {
	const parent = assertSamePhysicalDirectory(
		dirname(args.treePath),
		args.originalCapture.parent,
		"scratch parent",
	);
	const tree = inspectPlainDirectory(args.treePath, "scratch root");
	if (!sameIdentity(tree, args.originalCapture.tree)) {
		throw new Error("scratch root physical identity changed after rename");
	}
	validateMarker({
		treePath: args.treePath,
		originalRootPath: args.originalRootPath,
		createdBy: args.createdBy,
		parent,
		tree,
		markerTreeIdentity: args.originalCapture.tree,
	});
	return { parent, tree };
}

function describeCleanupFailureState(args) {
	const canonicalState = existsSync(args.originalRootPath)
		? "present"
		: "absent";
	if (!existsSync(args.quarantine)) {
		return `canonical root is ${canonicalState}; quarantine is absent`;
	}
	try {
		revalidateOwnedTree({
			treePath: args.quarantine,
			originalRootPath: args.originalRootPath,
			createdBy: args.createdBy,
			capture: args.movedCapture,
			markerTreeIdentity: args.originalCapture.tree,
		});
		return `canonical root is ${canonicalState}; authenticated quarantine residue remains at ${args.quarantine}`;
	} catch (error) {
		return `canonical root is ${canonicalState}; quarantine residue at ${args.quarantine} could not be authenticated (${error instanceof Error ? error.message : String(error)})`;
	}
}

function createOwnedRoot(args) {
	assertSamePhysicalDirectory(args.parent.path, args.parent, "scratch parent");
	if (existsSync(args.root)) {
		throw new Error(`scratch root reappeared before creation: ${args.root}`);
	}
	mkdirSync(args.root, { recursive: false });
	const tree = inspectPlainDirectory(args.root, "scratch root");
	assertSamePhysicalDirectory(args.parent.path, args.parent, "scratch parent");
	assertSamePhysicalDirectory(args.root, tree, "scratch root");
	writeFileSync(
		join(args.root, SCRATCH_MARKER_NAME),
		`${JSON.stringify(
			{
				schemaVersion: MARKER_SCHEMA_VERSION,
				createdBy: args.createdBy,
				createdAt: new Date().toISOString(),
				rootPath: args.root,
				parentPhysicalPath: args.parent.physicalPath,
				rootDevice: tree.device,
				rootInode: tree.inode,
			},
			null,
			2,
		)}\n`,
		{ encoding: "utf8", flag: "wx", mode: 0o600 },
	);
	captureOwnedTree({
		treePath: args.root,
		originalRootPath: args.root,
		createdBy: args.createdBy,
	});
}

/**
 * Replace one exact marker-owned scratch root. Hooks are test-only fault
 * injection points; production callers omit them.
 */
export function recreateOwnedScratchRoot({
	root,
	createdBy,
	log = () => {},
	hooks = {},
}) {
	const absoluteRoot = resolve(root);
	const parentPath = dirname(absoluteRoot);
	if (samePath(absoluteRoot, parentPath)) {
		throw new Error(
			`scratch root cannot be a filesystem root: ${absoluteRoot}`,
		);
	}
	if (typeof createdBy !== "string" || createdBy.length === 0) {
		throw new Error("scratch marker owner must be a non-empty string");
	}
	const parent = inspectPlainDirectory(parentPath, "scratch parent");

	if (existsSync(absoluteRoot)) {
		const capture = captureOwnedTree({
			treePath: absoluteRoot,
			originalRootPath: absoluteRoot,
			createdBy,
		});
		const quarantine = join(
			parentPath,
			`.${basename(absoluteRoot)}.opencut-replacing-${randomUUID()}`,
		);
		if (existsSync(quarantine)) {
			throw new Error(
				`scratch replacement quarantine already exists: ${quarantine}`,
			);
		}

		hooks.beforeRename?.({
			root: absoluteRoot,
			parent: parentPath,
			quarantine,
		});
		revalidateOwnedTree({
			treePath: absoluteRoot,
			originalRootPath: absoluteRoot,
			createdBy,
			capture,
		});
		renameSync(absoluteRoot, quarantine);
		log(
			"lifecycle: previous scratch root moved to an authenticated quarantine",
		);

		hooks.afterRenameBeforeCapture?.({
			root: absoluteRoot,
			parent: parentPath,
			quarantine,
		});
		const movedCapture = captureMovedOwnedTree({
			treePath: quarantine,
			originalRootPath: absoluteRoot,
			createdBy,
			originalCapture: capture,
		});
		hooks.beforeCleanup?.({
			root: absoluteRoot,
			parent: parentPath,
			quarantine,
		});
		revalidateOwnedTree({
			treePath: quarantine,
			originalRootPath: absoluteRoot,
			createdBy,
			capture: movedCapture,
			markerTreeIdentity: capture.tree,
		});
		try {
			if (hooks.cleanupQuarantine) {
				hooks.cleanupQuarantine({
					root: absoluteRoot,
					parent: parentPath,
					quarantine,
				});
			} else {
				rmSync(quarantine, { recursive: true, force: false });
			}
		} catch (error) {
			const state = describeCleanupFailureState({
				originalRootPath: absoluteRoot,
				quarantine,
				createdBy,
				originalCapture: capture,
				movedCapture,
			});
			throw new Error(
				`scratch cleanup failed; ${state}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (existsSync(quarantine)) {
			const state = describeCleanupFailureState({
				originalRootPath: absoluteRoot,
				quarantine,
				createdBy,
				originalCapture: capture,
				movedCapture,
			});
			throw new Error(
				`scratch cleanup returned without removing the quarantine; ${state}`,
			);
		}
		log("lifecycle: authenticated previous scratch root removed");
	}

	hooks.beforeCreate?.({ root: absoluteRoot, parent: parentPath });
	createOwnedRoot({ root: absoluteRoot, parent, createdBy });
	log(`lifecycle: fresh scratch root created with marker (${absoluteRoot})`);
}

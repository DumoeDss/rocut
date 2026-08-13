/**
 * Asset ports — where first-party static assets live, and how their bytes are
 * obtained.
 *
 * Split into two roles because they answer different questions and a Host may
 * well implement only one of them itself. `AssetResolver` answers *where*; it is
 * the seam that removes the root-absolute assumption E0 measured as the single
 * blocker for embedding (rewriting two root-absolute paths took the editor from
 * a fatal error to a booted timeline). `RuntimeAssetLoader` answers *with what
 * bytes*, so a Host that serves from an archive, a custom protocol or memory can
 * satisfy it without a URL that a `fetch` would accept.
 *
 * Rewiring the editor's existing call sites onto these is C4's, not this
 * change's. This change freezes their shape.
 */

/**
 * A reference to a Host-served asset.
 *
 * `path` is a logical, Host-agnostic path with no leading slash — `"fonts/font-atlas.json"`,
 * not `"/fonts/font-atlas.json"`. The leading slash is exactly the assumption
 * that has to stop being baked in, so the type documents its absence rather than
 * leaving it to convention.
 */
export interface AssetRef {
	readonly path: string;
}

export interface AssetResolver {
	/**
	 * Map a logical asset path to a location this Host serves it from.
	 *
	 * The returned string is opaque to the editor: a relative URL, an absolute
	 * URL, or a custom-scheme URL are all conforming. The editor never
	 * reconstructs it or reasons about its shape.
	 */
	resolve(args: { ref: AssetRef }): string;
}

export interface RuntimeAssetLoader {
	/** Fetch an asset's bytes. */
	loadBytes(args: { ref: AssetRef; signal?: AbortSignal }): Promise<ArrayBuffer>;

	/**
	 * Fetch and parse a JSON asset.
	 *
	 * Separate from `loadBytes` because a static Host answering `200 text/html`
	 * to an absent path is a measured trap (S01): a loader that only returned
	 * bytes would hand the caller an HTML page and let it fail later, somewhere
	 * else. Parsing at the port is where the failure is still attributable.
	 */
	loadJson<T = unknown>(args: {
		ref: AssetRef;
		signal?: AbortSignal;
	}): Promise<T>;
}

export const sameFrostBytes = (a, b) =>
	a.length === b.length && a.every((v, i) => v === b[i]);

export function auditCanonicalFrostSource(source, canonical, hard) {
	if (!source || !canonical) return;
	let opaqueExact = true;
	for (let i = 0; i < source.length; i += 4)
		if (source[i + 3] === 255)
			for (let c = 0; c < 4; c++)
				opaqueExact &&= source[i + c] === canonical[i + c];
	hard(
		"input",
		"canonicalOpaqueExact",
		opaqueExact,
		"Canvas ingress changed opaque authored bytes",
	);
}

export function frostPlateauOffsets(fixture, hard) {
	const plateau = [];
	for (let y = 0; y < fixture.height; y++)
		for (let x = 0; x < fixture.width; x++) {
			const distance = Math.hypot(
				x + 0.5 - Math.max(12.8, Math.min(51.2, x + 0.5)),
				y + 0.5 - 24,
			);
			if (distance < 5.76 - 1e-6) plateau.push((y * fixture.width + x) * 4);
		}
	hard(
		"fixture",
		"plateauCount",
		plateau.length === 568 &&
			plateau.filter((i) => fixture.source[i + 3] > 0).length === 459,
		"Independent pixel-center plateau topology changed",
	);
	return plateau;
}

export function auditFrostCaseInvariants(
	item,
	out,
	fixture,
	canonical,
	plateau,
	hard,
) {
	for (const [field, value] of Object.entries(out))
		if (value) {
			let alphaExact = true,
				holesZero = true;
			for (let i = 0; i < fixture.source.length; i += 4) {
				alphaExact &&= value[i + 3] === fixture.source[i + 3];
				if (fixture.source[i + 3] === 0)
					for (let c = 0; c < 4; c++) holesZero &&= value[i + c] === 0;
			}
			hard(
				item.id,
				`${field}AlphaExact`,
				alphaExact,
				"Active output alpha changed",
			);
			if (["nativeRgba", "canonicalNativeRgba"].includes(field))
				hard(
					item.id,
					`${field}HolesZero`,
					holesZero,
					"Native alpha-zero hole must be RGBA0",
				);
		}
	for (const field of ["diagnosticCanvasRgba", "readbackCanvasRgba"])
		if (out.defaultCanvasRgba && out[field])
			hard(
				item.id,
				`defaultEquals${field}`,
				sameFrostBytes(out.defaultCanvasRgba, out[field]),
				"Matching production Canvas outputs must be byte-identical",
			);
	if (["stamp-full", "hold-end", "restamped"].includes(item.id))
		for (const [field, expected] of [
			["nativeRgba", fixture.source],
			["canonicalNativeRgba", canonical],
		])
			if (out[field] && expected) {
				const exact = plateau
					.filter((i) => fixture.source[i + 3] > 0)
					.every((i) =>
						[0, 1, 2, 3].every((c) => out[field][i + c] === expected[i + c]),
					);
				hard(
					item.id,
					`${field}PlateauExact`,
					exact,
					"459 positive-alpha full-melt plateau pixels must exactly recover ingress bytes",
				);
			}
}

export function auditFrostCaseRelationships(
	manifest,
	native,
	canonicalNative,
	hard,
) {
	for (const group of manifest.hardInvariants.equivalence)
		for (const [field, values] of [
			["native", native],
			["canonicalNative", canonicalNative],
		]) {
			for (const id of group.slice(1))
				if (values.has(group[0]) && values.has(id))
					hard(
						id,
						`${field}Equivalence:${group[0]}`,
						sameFrostBytes(values.get(group[0]), values.get(id)),
						"Absolute-time equivalence must be exact",
					);
		}
	for (const [a, b] of [
		["static-ice", "stamp-full"],
		["stamp-full", "recover-half"],
		["recovered", "restamped"],
		["static-ice", "seed-variant"],
	])
		for (const [field, values] of [
			["native", native],
			["canonicalNative", canonicalNative],
		]) {
			if (values.has(a) && values.has(b))
				hard(
					b,
					`${field}Distinguishable:${a}`,
					!sameFrostBytes(values.get(a), values.get(b)),
					"Time/seed negative control is indistinguishable",
				);
		}
}

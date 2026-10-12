// Independent CPU color contract, not a production shader/renderer or PNG readback.
// Stephen Hill's ACES fit: https://github.com/TheRealMJP/BakingLab/blob/master/BakingLab/ACES.hlsl
// Fixed Rocut renderer exposure 1 uses the 1/.6 exposure convention, followed by sRGB8.
const INPUT = [[.59719, .35458, .04823], [.076, .90834, .01566], [.0284, .13383, .83777]];
const OUTPUT = [[1.60475, -.53108, -.07367], [-.10208, 1.10813, -.00605], [-.00327, -.07276, 1.07602]];
const multiply = (matrix, rgb) => matrix.map(row => row.reduce((sum, coefficient, i) => sum + coefficient * rgb[i], 0));
const clamp = value => Math.max(0, Math.min(1, value));

export function p1dAcesExposure1Linear(rgb) {
	const input = multiply(INPUT, rgb.map(channel => channel / .6));
	const fitted = input.map(value => (value * (value + .0245786) - .000090537)
		/ (value * (.983729 * value + .432951) + .238081));
	return multiply(OUTPUT, fitted).map(clamp);
}
export function p1dLinearToSrgb8(value) {
	const bounded = clamp(value);
	const encoded = bounded <= .0031308 ? bounded * 12.92 : 1.055 * Math.pow(bounded, 1 / 2.4) - .055;
	return Math.round(encoded * 255);
}
// The fixture's authored #00ff00 fill is linear [0,1,0]; no sampled colors enter this expectation.
export const P1D_SVG_COLOR_RGBA = Object.freeze([...p1dAcesExposure1Linear([0, 1, 0]).map(p1dLinearToSrgb8), 255]);

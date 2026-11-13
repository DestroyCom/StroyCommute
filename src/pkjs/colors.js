// Line colors for the watch. The Pebble Time 2 screen has 64 colors: each
// channel is one of 0x00, 0x55, 0xAA, 0xFF, and the firmware rounds any
// other value, which can leave the line's text unreadable on its banner.
// So both colors are rounded here, and a text color that ends up too close
// to its background is replaced by black or white.
// No `?.`, `??` or `**` here: the SDK's webpack 1 bundler predates them.

const MIN_CONTRAST = 3; // WCAG ratio for large/bold text

/**
 * @param {string} hex - "#RRGGBB" (or "#RGB").
 * @returns {?number[]} [r, g, b] 0-255, null if `hex` isn't a color.
 */
function parseHex(hex) {
	let s = String(hex || "")
		.trim()
		.replace(/^#/, "");
	if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, "$&$&");
	if (!/^[0-9a-f]{6}$/i.test(s)) return null;
	return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

/** @param {number[]} rgb @returns {string} "#RRGGBB", uppercase. */
function toHex(rgb) {
	return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** @param {number[]} rgb @returns {number[]} The nearest Pebble color. */
function toPalette(rgb) {
	return rgb.map((v) => Math.round(v / 85) * 85);
}

/** @param {number[]} rgb @returns {number} WCAG relative luminance. */
function luminance(rgb) {
	const [r, g, b] = rgb.map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @returns {number} WCAG contrast ratio between two colors (1 to 21). */
function contrast(a, b) {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * @param {string} color - Line color, any hex.
 * @param {string} textColor - Its text color, any hex.
 * @returns {{color: string, textColor: string}} Both as Pebble colors,
 *   the text readable on the background (gray/white when unparsable).
 */
function watchLineColors(color, textColor) {
	const bg = toPalette(parseHex(color) || [136, 136, 136]);
	let fg = toPalette(parseHex(textColor) || [255, 255, 255]);
	if (contrast(bg, fg) < MIN_CONTRAST) {
		const black = [0, 0, 0];
		const white = [255, 255, 255];
		fg = contrast(bg, black) >= contrast(bg, white) ? black : white;
	}
	return { color: toHex(bg), textColor: toHex(fg) };
}

module.exports = { watchLineColors, contrast, parseHex };

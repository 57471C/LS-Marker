//#region node_modules/.nitro/vite/services/ssr/assets/class-color-CbSKFqPj.js
var FALLBACK = [
	"#d7263d",
	"#e07a14",
	"#1f8a4c",
	"#2c6fbb",
	"#7b3ff2",
	"#c43e8a",
	"#8a5a12",
	"#0e7490"
];
function classFill(id, stored) {
	if (stored && /^#[0-9a-fA-F]{6}$/.test(stored)) return stored;
	return FALLBACK[Math.abs(id) % FALLBACK.length * 7 % FALLBACK.length];
}
function inkOn(fill) {
	const n = Number.parseInt(fill.slice(1), 16);
	if (!Number.isFinite(n)) return "#faf9f7";
	const channel = (c) => {
		const s = c / 255;
		return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
	};
	const r = channel(n >> 16 & 255);
	const g = channel(n >> 8 & 255);
	const b = channel(n & 255);
	return .2126 * r + .7152 * g + .0722 * b > .42 ? "#1c1b19" : "#faf9f7";
}
//#endregion
export { inkOn as n, classFill as t };

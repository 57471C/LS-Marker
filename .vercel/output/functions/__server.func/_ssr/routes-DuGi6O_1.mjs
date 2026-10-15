import { i as __toESM } from "../_runtime.mjs";
import { J as require_react, S as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { i as ChevronLeft, n as Trash2, r as ChevronRight } from "../_libs/lucide-react.mjs";
import { f as imageSrc, g as releaseImage, l as fetchCatalogue, n as useSession, r as claimImage, u as fetchLabel, y as saveLabel } from "./router-CRaHS7pq.mjs";
import { t as AppHeader } from "./app-header-BcfZmEKp.mjs";
import { n as inkOn, t as classFill } from "./class-color-CbSKFqPj.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-DuGi6O_1.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function clamp(n, min, max) {
	return Math.min(max, Math.max(min, n));
}
function round6(n) {
	return Math.round(n * 1e6) / 1e6;
}
function fromCorners(base, x0, y0, x1, y1) {
	const left = clamp(Math.min(x0, x1), 0, 1);
	const right = clamp(Math.max(x0, x1), 0, 1);
	const top = clamp(Math.min(y0, y1), 0, 1);
	const bottom = clamp(Math.max(y0, y1), 0, 1);
	const w = Math.max(right - left, .008);
	const h = Math.max(bottom - top, .008);
	let x = left;
	let y = top;
	if (x + w > 1) x = 1 - w;
	if (y + h > 1) y = 1 - h;
	return {
		key: base.key,
		classId: base.classId,
		x: round6(x + w / 2),
		y: round6(y + h / 2),
		w: round6(w),
		h: round6(h)
	};
}
function styleOf(box) {
	return {
		left: `${(box.x - box.w / 2) * 100}%`,
		top: `${(box.y - box.h / 2) * 100}%`,
		width: `${box.w * 100}%`,
		height: `${box.h * 100}%`
	};
}
var HANDLES = [
	"nw",
	"ne",
	"sw",
	"se"
];
function LabelStage({ src, alt, boxes, selectedKey, activeClassId, labelFor, colorFor, readOnly, onChange, onSelect }) {
	const frameRef = (0, import_react.useRef)(null);
	const overlayRef = (0, import_react.useRef)(null);
	const boxesRef = (0, import_react.useRef)(boxes);
	const dragRef = (0, import_react.useRef)(null);
	boxesRef.current = boxes;
	const [natural, setNatural] = (0, import_react.useState)(null);
	const [frame, setFrame] = (0, import_react.useState)({
		w: 0,
		h: 0
	});
	const [draft, setDraft] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		const el = frameRef.current;
		if (!el) return;
		const measure = () => {
			const rect = el.getBoundingClientRect();
			setFrame({
				w: rect.width,
				h: rect.height
			});
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	const fitted = (0, import_react.useMemo)(() => {
		if (!natural || frame.w < 1 || frame.h < 1) return null;
		const scale = Math.min(frame.w / natural.w, frame.h / natural.h);
		const width = natural.w * scale;
		const height = natural.h * scale;
		return {
			left: (frame.w - width) / 2,
			top: (frame.h - height) / 2,
			width,
			height
		};
	}, [natural, frame]);
	function point(event) {
		const el = overlayRef.current;
		if (!el) return null;
		const rect = el.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) return null;
		return {
			x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
			y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
		};
	}
	function finish(event) {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
		const drag = dragRef.current;
		dragRef.current = null;
		setDraft(null);
		if (!drag) return;
		if (drag.kind === "draw") {
			if (Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) < .01) return;
			const box = fromCorners({
				key: crypto.randomUUID(),
				classId: drag.classId
			}, drag.x0, drag.y0, drag.x1, drag.y1);
			onChange([...boxesRef.current, box]);
			onSelect(box.key);
			return;
		}
		onChange(boxesRef.current.map((box) => ({
			...box,
			x: round6(box.x),
			y: round6(box.y),
			w: round6(box.w),
			h: round6(box.h)
		})));
	}
	function onPointerDown(event) {
		if (readOnly || event.button !== 0) return;
		const here = point(event);
		if (!here) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		const target = event.target instanceof Element ? event.target : null;
		const handle = target?.closest("[data-corner]");
		const key = (target?.closest("[data-box]"))?.getAttribute("data-box");
		if (handle && key) {
			const box = boxesRef.current.find((item) => item.key === key);
			if (!box) return;
			onSelect(key);
			const corner = handle.getAttribute("data-corner");
			const left = box.x - box.w / 2;
			const top = box.y - box.h / 2;
			const right = box.x + box.w / 2;
			const bottom = box.y + box.h / 2;
			const anchor = {
				nw: {
					x: right,
					y: bottom
				},
				ne: {
					x: left,
					y: bottom
				},
				sw: {
					x: right,
					y: top
				},
				se: {
					x: left,
					y: top
				}
			}[corner];
			dragRef.current = {
				kind: "resize",
				key,
				anchorX: anchor.x,
				anchorY: anchor.y
			};
			return;
		}
		if (key) {
			const box = boxesRef.current.find((item) => item.key === key);
			if (!box) return;
			onSelect(key);
			dragRef.current = {
				kind: "move",
				key,
				dx: here.x - box.x,
				dy: here.y - box.y
			};
			return;
		}
		onSelect(null);
		if (activeClassId == null) return;
		dragRef.current = {
			kind: "draw",
			classId: activeClassId,
			x0: here.x,
			y0: here.y,
			x1: here.x,
			y1: here.y
		};
		setDraft({
			x0: here.x,
			y0: here.y,
			x1: here.x,
			y1: here.y
		});
	}
	function onPointerMove(event) {
		const drag = dragRef.current;
		if (!drag) return;
		const here = point(event);
		if (!here) return;
		if (drag.kind === "draw") {
			drag.x1 = here.x;
			drag.y1 = here.y;
			setDraft({
				x0: drag.x0,
				y0: drag.y0,
				x1: here.x,
				y1: here.y
			});
			return;
		}
		if (drag.kind === "move") {
			onChange(boxesRef.current.map((box) => {
				if (box.key !== drag.key) return box;
				return {
					...box,
					x: clamp(here.x - drag.dx, box.w / 2, 1 - box.w / 2),
					y: clamp(here.y - drag.dy, box.h / 2, 1 - box.h / 2)
				};
			}));
			return;
		}
		onChange(boxesRef.current.map((box) => {
			if (box.key !== drag.key) return box;
			return fromCorners(box, drag.anchorX, drag.anchorY, here.x, here.y);
		}));
	}
	const draftBox = draft && activeClassId != null ? fromCorners({
		key: "draft",
		classId: activeClassId
	}, draft.x0, draft.y0, draft.x1, draft.y1) : null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		ref: frameRef,
		className: "relative h-full min-h-72 w-full overflow-hidden rounded-lg bg-ink",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
			src,
			alt,
			draggable: false,
			onLoad: (event) => {
				const img = event.currentTarget;
				setNatural({
					w: img.naturalWidth,
					h: img.naturalHeight
				});
			},
			className: "h-full w-full object-contain select-none"
		}), fitted ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			ref: overlayRef,
			className: "absolute touch-none",
			style: fitted,
			onPointerDown,
			onPointerMove,
			onPointerUp: finish,
			onPointerCancel: finish,
			role: "application",
			"aria-label": "Draw bounding boxes",
			children: [boxes.map((box) => {
				const selected = box.key === selectedKey;
				const color = colorFor(box.classId);
				return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					"data-box": box.key,
					className: `box-mark absolute cursor-move ${selected ? "is-selected z-10" : "z-0"}`,
					style: {
						...styleOf(box),
						borderColor: color,
						boxShadow: selected ? `0 0 0 1px #faf9f7, 0 0 0 3px ${color}` : "0 0 0 1px rgba(28, 27, 25, 0.45)"
					},
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "pointer-events-none absolute bottom-full left-0 mb-1 max-w-full truncate rounded-xs px-1.5 py-0.5 font-mono text-xs",
						style: {
							background: color,
							color: inkOn(color)
						},
						children: labelFor(box.classId)
					}), selected ? HANDLES.map((corner) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						"data-corner": corner,
						className: `absolute z-20 h-4 w-4 rounded-xs border border-ink bg-surface ${corner === "nw" ? "-top-2 -left-2 cursor-nwse-resize" : corner === "ne" ? "-top-2 -right-2 cursor-nesw-resize" : corner === "sw" ? "-bottom-2 -left-2 cursor-nesw-resize" : "-right-2 -bottom-2 cursor-nwse-resize"}`
					}, corner)) : null]
				}, box.key);
			}), draftBox ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "box-mark pointer-events-none absolute z-20 border-dashed",
				style: {
					...styleOf(draftBox),
					borderColor: colorFor(draftBox.classId)
				}
			}) : null]
		}) : null]
	});
}
var field = "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
var btn = "press inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-sm font-medium text-ink disabled:opacity-40";
var btnPrimary = "press inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-ink px-4 text-sm font-medium text-surface disabled:opacity-40";
function serialize(boxes) {
	return JSON.stringify(boxes.map((box) => ({
		classId: box.classId,
		x: round6(box.x),
		y: round6(box.y),
		w: round6(box.w),
		h: round6(box.h)
	})));
}
function withKeys(boxes) {
	return boxes.map((box) => ({
		key: crypto.randomUUID(),
		classId: box.classId,
		x: round6(box.x),
		y: round6(box.y),
		w: round6(box.w),
		h: round6(box.h)
	}));
}
function parseCodes(text) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const part of text.split(/[\s,;]+/)) {
		const token = part.trim();
		if (!token) continue;
		const key = token.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(token);
	}
	return out;
}
function Labeler() {
	const { username } = useSession();
	const [catalogue, setCatalogue] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)(null);
	const [index, setIndex] = (0, import_react.useState)(0);
	const [boxes, setBoxes] = (0, import_react.useState)([]);
	const [saved, setSaved] = (0, import_react.useState)("[]");
	const [selectedKey, setSelectedKey] = (0, import_react.useState)(null);
	const [activeClassId, setActiveClassId] = (0, import_react.useState)(null);
	const [status, setStatus] = (0, import_react.useState)("Loading");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [queue, setQueue] = (0, import_react.useState)("all");
	const [confirmTakeover, setConfirmTakeover] = (0, import_react.useState)(false);
	const [codeList, setCodeList] = (0, import_react.useState)("");
	const [codesHydrated, setCodesHydrated] = (0, import_react.useState)(false);
	const allImages = catalogue?.images ?? [];
	const images = allImages.filter((image) => {
		if (queue === "mine") return image.claimedBy === username;
		if (queue === "free") return !image.claimedBy;
		return true;
	});
	const classes = catalogue?.classes ?? [];
	const safeIndex = images.length === 0 ? 0 : Math.min(index, images.length - 1);
	const current = images[safeIndex] ?? null;
	const ready = catalogue !== null;
	const folderOk = catalogue?.folderOk ?? false;
	const imageName = current?.name ?? null;
	const folderKey = catalogue?.resolvedFolder ?? "";
	const dirty = serialize(boxes) !== saved;
	const holder = current?.claimedBy ?? null;
	const locked = Boolean(holder && holder !== username);
	const lockedRef = (0, import_react.useRef)(false);
	lockedRef.current = locked;
	const actions = (0, import_react.useRef)({
		shift: (_delta) => {},
		save: async () => false,
		remove: () => {}
	});
	(0, import_react.useEffect)(() => {
		const stored = sessionStorage.getItem("part-lab-codes");
		if (stored) setCodeList(stored);
		setCodesHydrated(true);
	}, []);
	(0, import_react.useEffect)(() => {
		if (!codesHydrated) return;
		sessionStorage.setItem("part-lab-codes", codeList);
	}, [codeList, codesHydrated]);
	(0, import_react.useEffect)(() => {
		const stored = sessionStorage.getItem("part-lab-index");
		const parsed = Number(stored);
		if (Number.isInteger(parsed) && parsed >= 0) setIndex(parsed);
	}, []);
	(0, import_react.useEffect)(() => {
		sessionStorage.setItem("part-lab-index", String(safeIndex));
	}, [safeIndex]);
	(0, import_react.useEffect)(() => {
		let cancel = false;
		fetchCatalogue().then((data) => {
			if (cancel) return;
			setCatalogue(data);
			setError(null);
		}).catch((err) => {
			if (!cancel) setError(err instanceof Error ? err.message : "Could not load");
		});
		return () => {
			cancel = true;
		};
	}, []);
	const tokens = (0, import_react.useMemo)(() => parseCodes(codeList), [codeList]);
	const picks = (0, import_react.useMemo)(() => {
		const byIc = new Map(classes.map((row) => [row.ic.trim().toLowerCase(), row]));
		return tokens.flatMap((token) => {
			const row = byIc.get(token.toLowerCase());
			return row ? [row] : [];
		});
	}, [classes, tokens]);
	const unknownCodes = tokens.filter((token) => !picks.some((row) => row.ic.trim().toLowerCase() === token.toLowerCase()));
	const selectedBox = boxes.find((box) => box.key === selectedKey);
	const extra = selectedBox && !picks.some((row) => row.id === selectedBox.classId) ? classes.find((row) => row.id === selectedBox.classId) : void 0;
	const options = extra ? [extra, ...picks] : picks;
	(0, import_react.useEffect)(() => {
		setActiveClassId((prev) => prev != null && picks.some((row) => row.id === prev) ? prev : picks[0]?.id ?? null);
	}, [picks]);
	(0, import_react.useEffect)(() => {
		if (!ready || !folderOk || !imageName || !folderKey) {
			setBoxes([]);
			setSaved("[]");
			setSelectedKey(null);
			setStatus(!ready ? "Loading" : "No images");
			return;
		}
		let cancel = false;
		setBoxes([]);
		setSaved("[]");
		setSelectedKey(null);
		setStatus("Loading");
		fetchLabel(imageName).then((loaded) => {
			if (cancel) return;
			const next = withKeys(loaded);
			setBoxes(next);
			setSaved(serialize(next));
			setSelectedKey(null);
			setStatus("Saved");
			setError(null);
		}).catch((err) => {
			if (!cancel) setError(err instanceof Error ? err.message : "Could not read labels");
		});
		return () => {
			cancel = true;
		};
	}, [
		ready,
		folderOk,
		imageName,
		folderKey
	]);
	function labelFor(classId) {
		const row = classes.find((item) => item.id === classId);
		return row ? row.ic : `#${classId}`;
	}
	function colorFor(classId) {
		const row = classes.find((item) => item.id === classId);
		return classFill(classId, row?.color);
	}
	function classLine(row) {
		return `${row.id}  ${row.ic}  ${row.des}`;
	}
	async function save() {
		if (!current) return false;
		setBusy(true);
		try {
			await saveLabel(current.name, boxes.map((box) => ({
				classId: box.classId,
				x: round6(box.x),
				y: round6(box.y),
				w: round6(box.w),
				h: round6(box.h)
			})));
			setSaved(serialize(boxes));
			setStatus("Saved");
			setCatalogue((prev) => prev ? {
				...prev,
				images: prev.images.map((image) => image.name === current.name ? {
					...image,
					labelled: true,
					claimedBy: image.claimedBy ?? username,
					claimedAt: image.claimedAt ?? (/* @__PURE__ */ new Date()).toISOString()
				} : image)
			} : prev);
			setError(null);
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : "Save failed");
			setStatus("Save failed");
			return false;
		} finally {
			setBusy(false);
		}
	}
	async function shift(delta) {
		if (images.length === 0) return;
		if (dirty) {
			if (!await save()) return;
		}
		setIndex((value) => {
			const currentIndex = Math.min(value, images.length - 1);
			return Math.min(images.length - 1, Math.max(0, currentIndex + delta));
		});
	}
	function removeSelected() {
		if (lockedRef.current) return;
		if (!selectedKey) return;
		setBoxes((prev) => prev.filter((box) => box.key !== selectedKey));
		setSelectedKey(null);
	}
	function chooseClass(id) {
		if (lockedRef.current) return;
		setActiveClassId(id);
		if (!selectedKey) return;
		setBoxes((prev) => prev.map((box) => box.key === selectedKey ? {
			...box,
			classId: id
		} : box));
	}
	function selectBox(key) {
		setSelectedKey(key);
		if (!key) return;
		const box = boxes.find((item) => item.key === key);
		if (box) setActiveClassId(box.classId);
	}
	actions.current = {
		shift,
		save,
		remove: removeSelected
	};
	(0, import_react.useEffect)(() => {
		function onKey(event) {
			const tag = event.target instanceof HTMLElement ? event.target.tagName : "";
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				actions.current.shift(-1);
			} else if (event.key === "ArrowRight") {
				event.preventDefault();
				actions.current.shift(1);
			} else if ((event.key === "Delete" || event.key === "Backspace") && !event.metaKey && !event.ctrlKey) {
				event.preventDefault();
				actions.current.remove();
			} else if ((event.key === "s" || event.key === "S") && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				actions.current.save();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	function showQueue(next) {
		const name = current?.name ?? null;
		const rows = allImages.filter((image) => {
			if (next === "mine") return image.claimedBy === username;
			if (next === "free") return !image.claimedBy;
			return true;
		});
		const found = name ? rows.findIndex((image) => image.name === name) : -1;
		setQueue(next);
		setIndex(found >= 0 ? found : 0);
		setConfirmTakeover(false);
	}
	async function refreshClaims(patch) {
		setCatalogue((prev) => prev ? {
			...prev,
			images: prev.images.map((image) => image.name === current?.name ? patch(image) : image)
		} : prev);
	}
	async function claim(takeover = false) {
		if (!current) return;
		setBusy(true);
		try {
			await claimImage(current.name, takeover);
			const at = (/* @__PURE__ */ new Date()).toISOString();
			await refreshClaims((image) => ({
				...image,
				claimedBy: username,
				claimedAt: at
			}));
			setConfirmTakeover(false);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not claim");
		} finally {
			setBusy(false);
		}
	}
	async function release() {
		if (!current) return;
		setBusy(true);
		try {
			await releaseImage(current.name);
			await refreshClaims((image) => ({
				...image,
				claimedBy: null,
				claimedAt: null
			}));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not release");
		} finally {
			setBusy(false);
		}
	}
	const position = images.length === 0 ? "image 0 of 0" : `image ${safeIndex + 1} of ${images.length}`;
	const claimLabel = !current ? "" : holder === username ? "Yours" : holder ? holder : "Free";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex h-dvh flex-col bg-bg text-ink",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppHeader, {
				current: "label",
				meta: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "max-w-44 truncate font-mono text-sm text-muted tabular-nums sm:max-w-xs",
						children: current?.name ?? "—"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-mono text-sm text-ink tabular-nums",
						children: position
					}),
					current ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-mono text-sm text-muted",
						children: claimLabel
					}) : null
				] })
			}),
			error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "border-b border-line bg-surface px-4 py-2 text-sm text-ink",
				role: "alert",
				children: error
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex min-h-0 flex-1 flex-col lg:flex-row",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "flex min-h-80 min-w-0 flex-1 flex-col",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "min-h-0 flex-1 p-3",
						children: current && catalogue?.folderOk ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LabelStage, {
							src: imageSrc(current.name),
							alt: current.name,
							boxes,
							selectedKey,
							activeClassId,
							labelFor,
							colorFor,
							readOnly: locked,
							onChange: setBoxes,
							onSelect: selectBox
						}, `${folderKey}/${current.name}`) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "flex h-full min-h-72 items-center justify-center rounded-lg bg-ink px-6 text-center text-sm text-surface",
							children: catalogue?.folderError ?? (catalogue ? allImages.length ? "Nothing in this queue." : "This folder has no images." : "Loading images")
						})
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-center gap-2 border-t border-line px-3 py-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								className: btn,
								onClick: () => void shift(-1),
								disabled: !current || safeIndex === 0 || busy,
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, {
									className: "size-4",
									"aria-hidden": "true"
								}), "Previous"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: btnPrimary,
								onClick: () => void save(),
								disabled: !current || busy || !dirty || locked,
								children: "Save"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								className: btn,
								onClick: () => void shift(1),
								disabled: !current || safeIndex >= images.length - 1 || busy,
								children: ["Next", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, {
									className: "size-4",
									"aria-hidden": "true"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "ml-auto text-sm text-muted",
								"aria-live": "polite",
								children: [
									dirty ? "Unsaved" : status,
									current?.labelled ? " · txt" : "",
									locked ? " · locked" : ""
								]
							})
						]
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "flex max-h-96 w-full flex-col gap-4 overflow-auto border-t border-line bg-surface p-4 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "flex flex-col gap-2 text-sm font-medium",
							children: ["Codes on this image", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
								className: "min-h-24 w-full rounded-sm border border-line bg-bg px-3 py-2 font-mono text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent",
								value: codeList,
								spellCheck: false,
								disabled: locked,
								placeholder: "HX-M8\nNUT-M8",
								onChange: (event) => setCodeList(event.target.value)
							})]
						}),
						tokens.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "text-sm text-muted",
							children: [
								picks.length,
								" of ",
								tokens.length,
								" codes are in the class list.",
								unknownCodes.length > 0 ? ` Missing: ${unknownCodes.join(", ")}` : ""
							]
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm text-muted",
							children: "Paste item codes. The class menu only lists those."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "flex flex-col gap-2 text-sm font-medium",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "flex items-center gap-2",
								children: ["Class", activeClassId != null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "size-3 rounded-full",
									style: { background: colorFor(activeClassId) },
									"aria-hidden": "true"
								}) : null]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
								className: field,
								value: options.some((row) => row.id === activeClassId) ? activeClassId ?? "" : "",
								disabled: options.length === 0 || locked,
								onChange: (event) => chooseClass(Number(event.target.value)),
								children: [options.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "",
									children: "Paste item codes"
								}) : null, options.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: row.id,
									children: classLine(row)
								}, row.id))]
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex min-h-0 flex-col gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex items-center justify-between text-sm font-medium",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Boxes" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "font-mono text-muted tabular-nums",
									children: boxes.length
								})]
							}), boxes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-muted",
								children: "Drag on the image. The selected class is written into the YOLO file."
							}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
								className: "flex flex-col gap-1",
								children: boxes.map((box, boxIndex) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									className: "flex items-center gap-1",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										type: "button",
										onClick: () => selectBox(box.key),
										className: `press h-11 min-w-0 flex-1 truncate rounded-sm px-3 text-left font-mono text-sm ${box.key === selectedKey ? "bg-ink text-surface" : "bg-bg text-ink"}`,
										style: { boxShadow: `inset 4px 0 0 ${colorFor(box.classId)}` },
										children: [
											boxIndex + 1,
											" ",
											labelFor(box.classId)
										]
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: btn,
										disabled: locked,
										"aria-label": `Delete box ${boxIndex + 1}`,
										onClick: () => {
											setBoxes((prev) => prev.filter((item) => item.key !== box.key));
											if (selectedKey === box.key) setSelectedKey(null);
										},
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, {
											className: "size-4",
											"aria-hidden": "true"
										})
									})]
								}, box.key))
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-auto flex flex-col gap-3 border-t border-line pt-4",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex flex-col gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "text-sm font-medium",
										children: "Queue"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "flex flex-wrap gap-1",
										children: [
											["all", "All"],
											["mine", "Mine"],
											["free", "Free"]
										].map(([key, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											className: queue === key ? "press inline-flex h-11 items-center rounded-sm bg-ink px-3 text-sm font-medium text-surface" : "press inline-flex h-11 items-center rounded-sm border border-line bg-surface px-3 text-sm font-medium text-ink",
											onClick: () => showQueue(key),
											children: label
										}, key))
									})]
								}),
								current ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex flex-col gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "text-sm text-muted",
										children: holder === username ? "You have this image. Release it when you are done." : holder ? `Claimed by ${holder}. Take over to edit.` : "Free. Saving claims it for you."
									}), holder === username ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: btn,
										disabled: busy,
										onClick: () => void release(),
										children: "Release"
									}) : holder ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: btn,
										disabled: busy,
										onClick: () => {
											if (!confirmTakeover) {
												setConfirmTakeover(true);
												return;
											}
											claim(true);
										},
										children: confirmTakeover ? "Confirm takeover" : "Take over"
									}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: btn,
										disabled: busy,
										onClick: () => void claim(false),
										children: "Claim"
									})]
								}) : null,
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "text-sm text-muted break-all",
									children: catalogue?.folderOk ? catalogue.resolvedFolder : catalogue?.folderError ?? "—"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "text-sm text-muted",
									children: "The image folder is changed in Settings. Arrows move between images. Delete removes the selected box."
								})
							]
						})
					]
				})]
			})
		]
	});
}
var SplitComponent = Labeler;
//#endregion
export { SplitComponent as component };

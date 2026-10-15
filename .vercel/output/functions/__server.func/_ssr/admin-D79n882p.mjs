import { i as __toESM } from "../_runtime.mjs";
import { J as require_react, S as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { i as createClass, l as fetchCatalogue, o as deleteClass, p as importClasses, x as updateClass } from "./router-CRaHS7pq.mjs";
import { t as AppHeader } from "./app-header-BcfZmEKp.mjs";
import { t as classFill } from "./class-color-CbSKFqPj.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin-D79n882p.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var field = "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
var btn = "press inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-sm font-medium text-ink disabled:opacity-40";
var btnPrimary = "press inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-ink px-4 text-sm font-medium text-surface disabled:opacity-40";
function ClassesAdmin() {
	const [classes, setClasses] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)(null);
	const [ic, setIc] = (0, import_react.useState)("");
	const [des, setDes] = (0, import_react.useState)("");
	const [editing, setEditing] = (0, import_react.useState)(null);
	const [editIc, setEditIc] = (0, import_react.useState)("");
	const [editDes, setEditDes] = (0, import_react.useState)("");
	const [pendingDelete, setPendingDelete] = (0, import_react.useState)(null);
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [query, setQuery] = (0, import_react.useState)("");
	const [importNote, setImportNote] = (0, import_react.useState)(null);
	async function load() {
		const data = await fetchCatalogue();
		setClasses(data.classes);
	}
	(0, import_react.useEffect)(() => {
		let cancel = false;
		fetchCatalogue().then((data) => {
			if (!cancel) setClasses(data.classes);
		}).catch((err) => {
			if (!cancel) setError(err instanceof Error ? err.message : "Could not load classes");
		});
		return () => {
			cancel = true;
		};
	}, []);
	async function run(task) {
		setBusy(true);
		setError(null);
		try {
			await task();
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Request failed");
		} finally {
			setBusy(false);
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex min-h-dvh flex-col bg-bg text-ink",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppHeader, { current: "classes" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
			className: "mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "text-lg font-medium tracking-tight",
						children: "Classes"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "max-w-xl text-sm text-muted",
						children: "The number is the YOLO class id stored in each label file. Ids stay put when you rename a code. A removed id is left blank in classes.txt and is not reused. Each class is given a colour on its own — you don't pick one."
					})]
				}),
				error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "rounded-sm border border-line bg-surface px-3 py-2 text-sm",
					role: "alert",
					children: error
				}) : null,
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto]",
					onSubmit: (event) => {
						event.preventDefault();
						run(async () => {
							await createClass(ic, des);
							setIc("");
							setDes("");
						});
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "flex flex-col gap-2 text-sm font-medium",
							children: ["Item code", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: field,
								value: ic,
								onChange: (event) => setIc(event.target.value),
								required: true
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "flex flex-col gap-2 text-sm font-medium",
							children: ["Description", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: field,
								value: des,
								onChange: (event) => setDes(event.target.value),
								required: true
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "flex items-end",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "submit",
								className: btnPrimary,
								disabled: busy,
								children: "Add class"
							})
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "flex flex-col gap-3 rounded-xl border border-line bg-surface p-4",
					onSubmit: (event) => {
						event.preventDefault();
						const input = event.currentTarget.elements.namedItem("classes-csv");
						const file = input instanceof HTMLInputElement ? input.files?.[0] : void 0;
						if (!file) return;
						run(async () => {
							const csv = await file.text();
							const result = await importClasses(csv);
							setImportNote(`Added ${result.added}. Ignored ${result.skipped} duplicates${result.invalid ? ` and ${result.invalid} invalid rows` : ""}.`);
							if (input instanceof HTMLInputElement) input.value = "";
						});
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "flex flex-col gap-2 text-sm font-medium",
							children: ["CSV", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								id: "classes-csv",
								name: "classes-csv",
								className: field,
								type: "file",
								accept: ".csv,text/csv,text/plain"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "text-sm text-muted",
							children: [
								"Columns ",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "font-mono",
									children: "ic"
								}),
								" and ",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "font-mono",
									children: "des"
								}),
								". A code already in the list is skipped."
							]
						}),
						importNote ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm",
							children: importNote
						}) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "submit",
							className: btn,
							disabled: busy,
							children: "Upload CSV"
						}) })
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "flex flex-col gap-2 text-sm font-medium",
					children: ["Find", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						className: field,
						value: query,
						placeholder: "Item code or description",
						onChange: (event) => setQuery(event.target.value)
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ClassList, {
					classes,
					query,
					editing,
					editIc,
					editDes,
					pendingDelete,
					busy,
					onEditIc: setEditIc,
					onEditDes: setEditDes,
					onStartEdit: (row) => {
						setEditing(row.id);
						setEditIc(row.ic);
						setEditDes(row.des);
						setPendingDelete(null);
					},
					onCancelEdit: () => setEditing(null),
					onSaveEdit: (row) => {
						run(async () => {
							await updateClass({
								id: row.id,
								ic: editIc,
								des: editDes
							});
							setEditing(null);
						});
					},
					onDelete: (row) => {
						if (pendingDelete !== row.id) {
							setPendingDelete(row.id);
							return;
						}
						run(async () => {
							await deleteClass(row.id);
							setPendingDelete(null);
						});
					}
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "max-w-xl text-sm text-muted",
					children: "Saving a free image claims it for you. Someone else’s claim has to be taken over before you can change it."
				})
			]
		})]
	});
}
var LIST_CAP = 80;
function ClassList({ classes, query, editing, editIc, editDes, pendingDelete, busy, onEditIc, onEditDes, onStartEdit, onCancelEdit, onSaveEdit, onDelete }) {
	const needle = query.trim().toLowerCase();
	const matched = (classes ?? []).filter((row) => {
		if (!needle) return true;
		return row.ic.toLowerCase().includes(needle) || row.des.toLowerCase().includes(needle);
	});
	const shown = matched.slice(0, LIST_CAP);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-sm text-muted",
			children: classes == null ? "Loading" : matched.length > shown.length ? `Showing ${shown.length} of ${matched.length}` : `${matched.length} classes`
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
			className: "flex flex-col gap-2",
			children: [shown.map((row) => {
				const isEditing = editing === row.id;
				return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "rounded-lg border border-line bg-surface p-3",
					children: isEditing ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "grid gap-3 sm:grid-cols-[5.5rem_1fr_1fr_auto]",
						onSubmit: (event) => {
							event.preventDefault();
							onSaveEdit(row);
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "flex h-11 items-center gap-2 font-mono text-sm tabular-nums",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "size-3 shrink-0 rounded-full",
									style: { background: classFill(row.id, row.color) },
									"aria-hidden": "true"
								}), row.id]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: field,
								value: editIc,
								onChange: (event) => onEditIc(event.target.value),
								required: true
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: field,
								value: editDes,
								onChange: (event) => onEditDes(event.target.value),
								required: true
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "submit",
									className: btnPrimary,
									disabled: busy,
									children: "Save"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: btn,
									onClick: onCancelEdit,
									children: "Cancel"
								})]
							})
						]
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "grid items-center gap-3 sm:grid-cols-[5.5rem_8rem_1fr_auto]",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "flex items-center gap-2 font-mono text-sm tabular-nums",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "size-3 shrink-0 rounded-full",
									style: { background: classFill(row.id, row.color) },
									"aria-hidden": "true"
								}), row.id]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "truncate font-mono text-sm",
								children: row.ic
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "truncate text-sm text-muted",
								children: row.des
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: btn,
									onClick: () => onStartEdit(row),
									children: "Edit"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: btn,
									onClick: () => onDelete(row),
									children: pendingDelete === row.id ? "Confirm" : "Delete"
								})]
							})
						]
					})
				}, row.id);
			}), classes && matched.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
				className: "text-sm text-muted",
				children: "No classes match."
			}) : null]
		})]
	});
}
var SplitComponent = ClassesAdmin;
//#endregion
export { SplitComponent as component };

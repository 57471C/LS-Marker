import { i as __toESM } from "../_runtime.mjs";
import { J as require_react, S as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { _ as resetUserPassword, a as createUser, b as unlockAdmin, c as fetchAdmin, d as fetchUsers, l as fetchCatalogue, m as lockAdmin, s as deleteUser, v as saveFolder } from "./router-CRaHS7pq.mjs";
import { t as AppHeader } from "./app-header-BcfZmEKp.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/settings-CF603ZwS.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var field = "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
var btn = "press inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-sm font-medium text-ink disabled:opacity-40";
var btnPrimary = "press inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-ink px-4 text-sm font-medium text-surface disabled:opacity-40";
function SettingsPage() {
	const [unlocked, setUnlocked] = (0, import_react.useState)(null);
	const [password, setPassword] = (0, import_react.useState)("");
	const [users, setUsers] = (0, import_react.useState)(null);
	const [username, setUsername] = (0, import_react.useState)("");
	const [userPassword, setUserPassword] = (0, import_react.useState)("");
	const [editing, setEditing] = (0, import_react.useState)(null);
	const [nextPassword, setNextPassword] = (0, import_react.useState)("");
	const [pendingDelete, setPendingDelete] = (0, import_react.useState)(null);
	const [folder, setFolder] = (0, import_react.useState)("");
	const [folderNote, setFolderNote] = (0, import_react.useState)("");
	const [error, setError] = (0, import_react.useState)(null);
	const [busy, setBusy] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		let cancel = false;
		fetchAdmin().then((open) => {
			if (!cancel) setUnlocked(open);
		}).catch((err) => {
			if (!cancel) setError(err instanceof Error ? err.message : "Could not check settings");
		});
		return () => {
			cancel = true;
		};
	}, []);
	(0, import_react.useEffect)(() => {
		if (!unlocked) return;
		let cancel = false;
		Promise.all([fetchUsers(), fetchCatalogue()]).then(([rows, catalogue]) => {
			if (cancel) return;
			setUsers(rows);
			setFolder(catalogue.imageFolder);
			setFolderNote(catalogue.folderOk ? catalogue.resolvedFolder : catalogue.folderError ?? "");
		}).catch((err) => {
			if (!cancel) setError(err instanceof Error ? err.message : "Could not load settings");
		});
		return () => {
			cancel = true;
		};
	}, [unlocked]);
	async function run(task) {
		setBusy(true);
		setError(null);
		try {
			await task();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Request failed");
		} finally {
			setBusy(false);
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex min-h-dvh flex-col bg-bg text-ink",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppHeader, { current: "settings" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
			className: "mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "text-lg font-medium tracking-tight",
						children: "Settings"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "max-w-xl text-sm text-muted",
						children: "Labellers sign in with a name and password. This page is separate, and it uses the shared settings password."
					})]
				}),
				error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "rounded-sm border border-line bg-surface px-3 py-2 text-sm",
					role: "alert",
					children: error
				}) : null,
				unlocked === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted",
					children: "Checking the lock…"
				}) : null,
				unlocked === false ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "flex max-w-sm flex-col gap-3 rounded-xl border border-line bg-surface p-4",
					onSubmit: (event) => {
						event.preventDefault();
						run(async () => {
							await unlockAdmin(password);
							setPassword("");
							setUnlocked(true);
						});
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "flex flex-col gap-2 text-sm font-medium",
							children: ["Settings password", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: field,
								type: "password",
								autoComplete: "current-password",
								value: password,
								onChange: (event) => setPassword(event.target.value),
								required: true
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm text-muted",
							children: "The shared password is admin."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "submit",
							className: btnPrimary,
							disabled: busy,
							children: "Unlock"
						})
					]
				}) : null,
				unlocked ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto]",
						onSubmit: (event) => {
							event.preventDefault();
							run(async () => {
								await createUser(username, userPassword);
								setUsers(await fetchUsers());
								setUsername("");
								setUserPassword("");
							});
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex flex-col gap-2 text-sm font-medium",
								children: ["Username", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									className: field,
									value: username,
									onChange: (event) => setUsername(event.target.value),
									required: true
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex flex-col gap-2 text-sm font-medium",
								children: ["Password", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									className: field,
									type: "password",
									autoComplete: "new-password",
									value: userPassword,
									onChange: (event) => setUserPassword(event.target.value),
									required: true
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "flex items-end",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "submit",
									className: btnPrimary,
									disabled: busy,
									children: "Add user"
								})
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
						className: "flex flex-col gap-2",
						children: [(users ?? []).map((user) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
							className: "rounded-lg border border-line bg-surface p-3",
							children: editing === user.id ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
								className: "grid gap-3 sm:grid-cols-[1fr_1fr_auto]",
								onSubmit: (event) => {
									event.preventDefault();
									run(async () => {
										await resetUserPassword(user.id, nextPassword);
										setEditing(null);
										setNextPassword("");
									});
								},
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "flex h-11 items-center font-mono text-sm",
										children: user.username
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										className: field,
										type: "password",
										autoComplete: "new-password",
										placeholder: "New password",
										value: nextPassword,
										onChange: (event) => setNextPassword(event.target.value),
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
											onClick: () => setEditing(null),
											children: "Cancel"
										})]
									})
								]
							}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap items-center gap-3",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "min-w-0 flex-1 font-mono text-sm",
										children: user.username
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: btn,
										onClick: () => {
											setEditing(user.id);
											setNextPassword("");
											setPendingDelete(null);
										},
										children: "Reset password"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: btn,
										onClick: () => {
											if (pendingDelete !== user.id) {
												setPendingDelete(user.id);
												return;
											}
											run(async () => {
												await deleteUser(user.id);
												setUsers(await fetchUsers());
												setPendingDelete(null);
											});
										},
										children: pendingDelete === user.id ? "Confirm" : "Delete"
									})
								]
							})
						}, user.id)), users && users.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
							className: "text-sm text-muted",
							children: "No labellers yet."
						}) : null]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "flex flex-col gap-3 rounded-xl border border-line bg-surface p-4",
						onSubmit: (event) => {
							event.preventDefault();
							run(async () => {
								const catalogue = await saveFolder(folder);
								setFolder(catalogue.imageFolder);
								setFolderNote(catalogue.folderOk ? catalogue.resolvedFolder : catalogue.folderError ?? "");
							});
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex flex-col gap-2 text-sm font-medium",
								htmlFor: "image-folder",
								children: ["Image folder", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									id: "image-folder",
									className: field,
									value: folder,
									spellCheck: false,
									onChange: (event) => setFolder(event.target.value)
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-muted break-all",
								children: folderNote || "—"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "submit",
								className: btn,
								disabled: busy,
								children: "Use folder"
							}) })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: btn,
						onClick: () => {
							run(async () => {
								await lockAdmin();
								setUnlocked(false);
								setUsers(null);
							});
						},
						children: "Lock settings"
					}) })
				] }) : null
			]
		})]
	});
}
var SplitComponent = SettingsPage;
//#endregion
export { SplitComponent as component };

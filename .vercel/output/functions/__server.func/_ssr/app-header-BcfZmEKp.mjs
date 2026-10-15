import { S as require_jsx_runtime, b as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { h as logout, n as useSession } from "./router-CRaHS7pq.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/app-header-BcfZmEKp.js
var import_jsx_runtime = require_jsx_runtime();
function AppHeader({ current, meta }) {
	const { username, setUsername } = useSession();
	const item = (key) => current === key ? "inline-flex h-11 items-center rounded-sm bg-ink px-3 text-sm font-medium text-surface" : "inline-flex h-11 items-center rounded-sm px-3 text-sm font-medium text-muted";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/",
				className: "text-lg font-medium tracking-tight text-ink",
				children: "Part lab"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
				className: "flex items-center gap-1",
				"aria-label": "Sections",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/",
						className: item("label"),
						children: "Label"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/admin",
						className: item("classes"),
						children: "Classes"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/settings",
						className: item("settings"),
						children: "Settings"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "ml-auto flex min-w-0 flex-wrap items-center gap-3",
				children: [meta, username ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "truncate font-mono text-sm text-muted",
					children: username
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "press inline-flex h-11 items-center rounded-sm border border-line bg-surface px-3 text-sm font-medium text-ink",
					onClick: () => {
						logout().finally(() => setUsername(null));
					},
					children: "Sign out"
				})] }) : null]
			})
		]
	});
}
//#endregion
export { AppHeader as t };

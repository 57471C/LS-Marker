import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ProjectSplash } from "@/components/project-splash";
import { LoginScreen } from "@/components/login-screen";
import { fetchMe } from "@/lib/label-client";
import { ProjectProvider, useProject } from "@/lib/project";
import { SessionContext } from "@/lib/session";
import appCss from "../styles.css?url";

const APP_NAME = "LS-Marker";

function Shell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const settings = pathname === "/settings";

  useEffect(() => {
    let cancel = false;
    fetchMe()
      .then((user) => {
        if (!cancel) setUsername(user?.username ?? null);
      })
      .catch(() => {
        if (!cancel) setUsername(null);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const onSignedOut = () => setUsername(null);
    window.addEventListener("partlab-signed-out", onSignedOut);
    return () => window.removeEventListener("partlab-signed-out", onSignedOut);
  }, []);

  let body = <Outlet />;
  if (!settings && username === undefined) {
    body = (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-sm text-muted">
        Loading
      </div>
    );
  } else if (!settings && !username) {
    body = <LoginScreen onIn={setUsername} />;
  }

  return (
    <SessionContext.Provider value={{ username: username ?? null, setUsername }}>
      <ProjectProvider username={username ?? null}>
        <GatedBody settings={settings} signedIn={Boolean(username)}>
          {body}
        </GatedBody>
      </ProjectProvider>
    </SessionContext.Provider>
  );
}

function GatedBody({
  settings,
  signedIn,
  children,
}: {
  settings: boolean;
  signedIn: boolean;
  children: ReactNode;
}) {
  const { current, ready, picker, closePicker } = useProject();
  if (signedIn && !ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-sm text-muted">
        Loading
      </div>
    );
  }
  const mustPick = signedIn && !settings && !current;
  return (
    <>
      {mustPick ? null : children}
      {mustPick || picker ? <ProjectSplash canClose={!mustPick} onClose={closePicker} /> : null}
    </>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "theme-color", content: "#f3f1ee" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <Shell />
        <Scripts />
      </body>
    </html>
  ),
});

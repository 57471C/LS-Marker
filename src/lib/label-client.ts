export type ClassRow = { id: number; ic: string; des: string; color: string };
export type ImageRow = {
  name: string;
  labelled: boolean;
  claimedBy: string | null;
  claimedAt: string | null;
};
export type Box = { classId: number; x: number; y: number; w: number; h: number };

export type Catalogue = {
  project: { id: number; name: string };
  imageFolder: string;
  resolvedFolder: string;
  folderOk: boolean;
  folderError: string | null;
  images: ImageRow[];
  classes: ClassRow[];
};

export type Project = {
  id: number;
  name: string;
  folder: string;
  resolvedFolder: string;
  folderOk: boolean;
  folderError: string | null;
  totalPhotos?: number;
  completePhotos?: number;
};

function api(path: string): string {
  return path;
}

async function failMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    /* response was not JSON */
  }
  return res.statusText || "Request failed";
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await failMessage(res);
    if (res.status === 401 && message === "Sign in" && typeof window !== "undefined") {
      window.dispatchEvent(new Event("partlab-signed-out"));
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function downloadYoloExport(projectId?: number): Promise<void> {
  const query = projectId != null ? `?id=${encodeURIComponent(projectId)}` : "";
  const res = await fetch(api(`/api/export${query}`));
  if (!res.ok) {
    const message = await failMessage(res);
    if (res.status === 401 && message === "Sign in" && typeof window !== "undefined") {
      window.dispatchEvent(new Event("partlab-signed-out"));
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const disposition = res.headers.get("content-disposition");
  let filename = "yolo.zip";
  if (disposition) {
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match?.[1]) filename = match[1];
  }
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function imageSrc(name: string): string {
  return api(`/api/image?name=${encodeURIComponent(name)}`);
}

export function fetchCatalogue(): Promise<Catalogue> {
  return fetch(api("/api/catalogue")).then((res) => asJson<Catalogue>(res));
}

export function fetchCurrentProject(): Promise<Project | null> {
  return fetch(api("/api/project"))
    .then((res) => asJson<{ project: Project | null }>(res))
    .then((data) => data.project);
}

export function fetchProjects(): Promise<Project[]> {
  return fetch(api("/api/projects"))
    .then((res) => asJson<{ projects: Project[] }>(res))
    .then((data) => data.projects);
}

export function createProject(name: string, folder: string): Promise<Project> {
  return fetch(api("/api/projects"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, folder }),
  })
    .then((res) => asJson<{ project: Project }>(res))
    .then((data) => data.project);
}

export function openProject(id: number): Promise<Project> {
  return fetch(api("/api/projects/open"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  })
    .then((res) => asJson<{ project: Project }>(res))
    .then((data) => data.project);
}

export async function deleteProject(id: number, password: string): Promise<void> {
  const res = await fetch(api("/api/projects"), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, password }),
  });
  await asJson(res);
}

export function fetchLabel(name: string): Promise<Box[]> {
  return fetch(api(`/api/label?name=${encodeURIComponent(name)}`))
    .then((res) => asJson<{ boxes: Box[] }>(res))
    .then((data) => data.boxes);
}

export async function saveLabel(name: string, boxes: Box[]): Promise<void> {
  const res = await fetch(api(`/api/label?name=${encodeURIComponent(name)}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ boxes }),
  });
  await asJson(res);
}

export function createClass(ic: string, des: string): Promise<ClassRow> {
  return fetch(api("/api/classes"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ic, des }),
  }).then((res) => asJson<ClassRow>(res));
}

export function importClasses(
  csv: string,
): Promise<{ added: number; skipped: number; invalid: number }> {
  return fetch(api("/api/classes/import"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ csv }),
  }).then((res) => asJson(res));
}

export function updateClass(row: Pick<ClassRow, "id" | "ic" | "des">): Promise<ClassRow> {
  return fetch(api("/api/classes"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(row),
  }).then((res) => asJson<ClassRow>(res));
}

export async function deleteClass(id: number): Promise<void> {
  const res = await fetch(api(`/api/classes?id=${id}`), { method: "DELETE" });
  await asJson(res);
}

export type LabUser = { id: number; username: string; createdAt: string };

export function fetchMe(): Promise<{ id: number; username: string } | null> {
  return fetch(api("/api/me"))
    .then((res) => asJson<{ user: { id: number; username: string } | null }>(res))
    .then((data) => data.user);
}

export function login(
  username: string,
  password: string,
): Promise<{ id: number; username: string }> {
  return fetch(api("/api/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  }).then((res) => asJson(res));
}

export async function logout(): Promise<void> {
  const res = await fetch(api("/api/logout"), { method: "POST" });
  await asJson(res);
}

export function fetchAdmin(): Promise<boolean> {
  return fetch(api("/api/admin"))
    .then((res) => asJson<{ unlocked: boolean }>(res))
    .then((data) => data.unlocked);
}

export function unlockAdmin(password: string): Promise<void> {
  return fetch(api("/api/admin/unlock"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  }).then((res) => asJson(res));
}

export async function lockAdmin(): Promise<void> {
  const res = await fetch(api("/api/admin/lock"), { method: "POST" });
  await asJson(res);
}

export function fetchUsers(): Promise<LabUser[]> {
  return fetch(api("/api/users"))
    .then((res) => asJson<{ users: LabUser[] }>(res))
    .then((data) => data.users);
}

export function createUser(
  username: string,
  password: string,
): Promise<{ id: number; username: string }> {
  return fetch(api("/api/users"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  }).then((res) => asJson(res));
}

export async function resetUserPassword(id: number, password: string): Promise<void> {
  const res = await fetch(api("/api/users"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, password }),
  });
  await asJson(res);
}

export async function deleteUser(id: number): Promise<void> {
  const res = await fetch(api(`/api/users?id=${id}`), { method: "DELETE" });
  await asJson(res);
}

export async function claimImage(name: string, takeover = false): Promise<void> {
  const res = await fetch(api("/api/claim"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, takeover }),
  });
  await asJson(res);
}

export async function releaseImage(name: string): Promise<void> {
  const res = await fetch(api(`/api/claim?name=${encodeURIComponent(name)}`), { method: "DELETE" });
  await asJson(res);
}

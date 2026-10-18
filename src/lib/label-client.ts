export type ClassRow = { id: number; ic: string; des: string; color: string };
export type PhotoStatus = "open" | "incomplete" | "complete";
export type ImageRow = {
  id?: number;
  name: string;
  labelled: boolean;
  claimedBy: string | null;
  claimedAt: string | null;
  status: PhotoStatus;
  completedAt: string | null;
  lockedBy?: string | null;
  lockedAt?: string | null;
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

export type ExportFormat = "yolo" | "coco";

export type DatasetExportType = "labels_only" | "full_tar";
export type YoloExportType = DatasetExportType;

export type DatasetExportOptions = {
  projectId: number;
  exportType: DatasetExportType;
  format?: ExportFormat;
  trainSplit?: number;
  signal?: AbortSignal;
  onProgress?: (bytesLoaded: number) => void;
};

export type YoloExportOptions = DatasetExportOptions;

export function datasetExportUrl(
  projectId: number,
  exportType: DatasetExportType,
  trainSplit = 80,
  format: ExportFormat = "yolo",
): string {
  const params = new URLSearchParams({
    id: String(projectId),
    type: exportType,
    split: String(Math.round(trainSplit)),
    format,
  });
  return api(`/api/export?${params.toString()}`);
}

export function yoloExportUrl(
  projectId: number,
  exportType: YoloExportType,
  trainSplit = 80,
): string {
  return datasetExportUrl(projectId, exportType, trainSplit, "yolo");
}

export function cocoExportUrl(
  projectId: number,
  exportType: DatasetExportType,
  trainSplit = 80,
): string {
  return datasetExportUrl(projectId, exportType, trainSplit, "coco");
}

export async function downloadDatasetExport(options: DatasetExportOptions): Promise<void> {
  const { projectId, exportType, format = "yolo", trainSplit = 80, signal, onProgress } = options;
  const res = await fetch(datasetExportUrl(projectId, exportType, trainSplit, format), { signal });
  if (!res.ok) {
    const message = await failMessage(res);
    if (res.status === 401 && message === "Sign in" && typeof window !== "undefined") {
      window.dispatchEvent(new Event("partlab-signed-out"));
    }
    throw new Error(message);
  }

  let blob: Blob;
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(new Uint8Array(value));
        loaded += value.byteLength;
        onProgress?.(loaded);
      }
    }
    blob = new Blob(chunks, { type: "application/x-tar" });
  } else {
    blob = await res.blob();
    onProgress?.(blob.size);
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const disposition = res.headers.get("content-disposition");
  let filename =
    format === "coco"
      ? exportType === "labels_only"
        ? "coco_annotations.tar"
        : "coco.tar"
      : exportType === "labels_only"
        ? "yolo_labels.tar"
        : "yolo.tar";
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

export async function downloadYoloExport(options: YoloExportOptions): Promise<void> {
  return downloadDatasetExport({ ...options, format: options.format ?? "yolo" });
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

export async function claimImage(
  name: string,
  takeover = false,
): Promise<{
  name: string;
  claimedBy: string;
  claimedAt: string;
  status: PhotoStatus;
  completedAt: string | null;
}> {
  const res = await fetch(api("/api/claim"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, takeover, action: "claim" }),
  });
  return asJson(res);
}

export async function releaseIncomplete(name: string): Promise<{
  name: string;
  claimedBy: null;
  claimedAt: null;
  status: PhotoStatus;
  completedAt: null;
}> {
  const res = await fetch(api("/api/claim"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, action: "release-incomplete" }),
  });
  return asJson(res);
}

export async function completeImage(
  name: string,
  boxes?: Box[],
): Promise<{
  name: string;
  claimedBy: string;
  claimedAt: string;
  status: PhotoStatus;
  completedAt: string;
}> {
  const res = await fetch(api("/api/claim"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, action: "complete", boxes }),
  });
  return asJson(res);
}

export async function releaseImage(name: string): Promise<void> {
  const res = await fetch(api(`/api/claim?name=${encodeURIComponent(name)}`), { method: "DELETE" });
  await asJson(res);
}

export async function fetchNextImage(): Promise<{
  id: number;
  name: string;
  claimedBy: string | null;
  claimedAt: string | null;
  status: PhotoStatus;
} | null> {
  const res = await fetch(api("/api/images/next"), {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const data = await asJson<{
    image: {
      id: number;
      file_path: string;
      locked_by: string;
      locked_at: string;
      status: string;
    } | null;
    id?: number;
    name?: string;
    claimedBy?: string;
    claimedAt?: string;
    status?: string;
  }>(res);
  if (!data.image && !data.id) return null;
  const name = data.name ?? data.image?.file_path ?? "";
  const rawStatus = data.status ?? data.image?.status ?? "open";
  const status: PhotoStatus =
    rawStatus === "completed" ? "complete" : rawStatus === "incomplete" ? "incomplete" : "open";
  return {
    id: data.id ?? data.image?.id ?? 0,
    name,
    claimedBy: data.claimedBy ?? data.image?.locked_by ?? null,
    claimedAt: data.claimedAt ?? data.image?.locked_at ?? null,
    status,
  };
}

export async function lockImage(nameOrId: string | number): Promise<{
  id: number;
  name: string;
  claimedBy: string;
  claimedAt: string;
}> {
  const body = typeof nameOrId === "number" ? { id: nameOrId } : { name: nameOrId };
  const res = await fetch(api("/api/images/lock"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return asJson(res);
}

export async function unlockImage(nameOrId: string | number): Promise<void> {
  const body = typeof nameOrId === "number" ? { id: nameOrId } : { name: nameOrId };
  const res = await fetch(api("/api/images/unlock"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await asJson(res);
}

export async function skipImage(nameOrId: string | number): Promise<void> {
  const body = typeof nameOrId === "number" ? { id: nameOrId } : { name: nameOrId };
  const res = await fetch(api("/api/images/skip"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await asJson(res);
}

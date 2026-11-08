export type PartType =
  | "none"
  | "bolt"
  | "nut"
  | "washer"
  | "label"
  | "cable_tie"
  | "spring"
  | "other"
  | (string & {});

export type MetrologyField =
  | "thread"
  | "length_mm"
  | "head_type"
  | "af_mm"
  | "height_mm"
  | "od_mm"
  | "id_mm"
  | "thickness_mm"
  | "width_mm"
  | "note";

export type MetrologyFieldInfo = {
  key: MetrologyField;
  label: string;
  unit?: string;
  type: "string" | "number";
  description: string;
};

export const ALL_METROLOGY_FIELDS: MetrologyFieldInfo[] = [
  {
    key: "thread",
    label: "Thread",
    unit: "text",
    type: "string",
    description: "e.g. M6, M8, 1/4-20",
  },
  {
    key: "length_mm",
    label: "Length",
    unit: "mm",
    type: "number",
    description: "Nominal or shank length",
  },
  {
    key: "head_type",
    label: "Head Type",
    unit: "text",
    type: "string",
    description: "e.g. Hex, Socket, Pan",
  },
  {
    key: "af_mm",
    label: "Across Flats (AF)",
    unit: "mm",
    type: "number",
    description: "Wrench or socket size",
  },
  {
    key: "height_mm",
    label: "Height",
    unit: "mm",
    type: "number",
    description: "Overall component height",
  },
  {
    key: "od_mm",
    label: "Outer Diameter (OD)",
    unit: "mm",
    type: "number",
    description: "Outer or cylinder diameter",
  },
  {
    key: "id_mm",
    label: "Inner Diameter (ID)",
    unit: "mm",
    type: "number",
    description: "Hole or bore diameter",
  },
  {
    key: "thickness_mm",
    label: "Thickness",
    unit: "mm",
    type: "number",
    description: "Material thickness",
  },
  { key: "width_mm", label: "Width", unit: "mm", type: "number", description: "Component width" },
  {
    key: "note",
    label: "Note",
    unit: "text",
    type: "string",
    description: "Material, color or custom note",
  },
];

export type PartTypeDefinition = {
  id: string;
  name: string;
  fields: MetrologyField[];
  required_fields: MetrologyField[];
  display_format: string | null;
  archived: boolean;
  created_at?: string;
};
export type ClassRow = {
  id: number;
  ic: string;
  des: string;
  color: string;
  part_type?: PartType | null;
  thread?: string | null;
  length_mm?: number | null;
  head_type?: string | null;
  af_mm?: number | null;
  height_mm?: number | null;
  od_mm?: number | null;
  id_mm?: number | null;
  thickness_mm?: number | null;
  width_mm?: number | null;
  note?: string | null;
  dimensions?: string | null;
  dim1_name?: string | null;
  dim1_mm?: number | null;
  dim2_name?: string | null;
  dim2_mm?: number | null;
  dim3_name?: string | null;
  dim3_mm?: number | null;
};
export type PhotoStatus = "open" | "incomplete" | "complete" | "approved";
export type ImageRow = {
  id?: number;
  project_id?: number;
  file_path?: string;
  name: string;
  labelled: boolean;
  claimedBy: string | null;
  claimedAt: string | null;
  status: PhotoStatus;
  completedAt: string | null;
  completedBy?: string | null;
  lockedBy?: string | null;
  lockedAt?: string | null;
  locked_by?: string | null;
  locked_at?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  owner?: string | null;
  is_claimed?: boolean;
  held_by?: string | null;
  held_minutes_remaining?: number;
  is_cropped?: boolean;
};
export type Box = {
  classId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  points?: [number, number][];
};

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
  approvedPhotos?: number;
};

function api(path: string): string {
  return path;
}

async function failMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; message?: string; output?: string };
    if (data.error) return data.error;
    if (data.output) return data.output;
    if (data.message) return data.message;
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

export type ExportFormat = "yolo" | "coco" | "dino" | "yolo-seg" | "yolo_dino" | "coco_dino";
export type ExportScope = "all" | "approved";

export type DatasetExportType = "labels_only" | "full_tar";
export type YoloExportType = DatasetExportType;

export type DatasetExportOptions = {
  projectId: number;
  projectName?: string;
  exportType: DatasetExportType;
  format?: ExportFormat;
  trainSplit?: number;
  scope?: ExportScope;
  classMode?: "ic" | "general";
  filename?: string;
  signal?: AbortSignal;
  onProgress?: (bytesLoaded: number) => void;
  onStatusChange?: (status: string) => void;
};

export type YoloExportOptions = DatasetExportOptions;

export function datasetExportUrl(
  projectId: number,
  exportType: DatasetExportType,
  trainSplit = 80,
  format: ExportFormat = "yolo",
  scope: ExportScope = "all",
  classMode?: "ic" | "general",
  filename?: string,
): string {
  const params = new URLSearchParams({
    id: String(projectId),
    type: exportType,
    split: String(Math.round(trainSplit)),
    format,
    scope,
  });
  if (classMode) {
    params.set("class_mode", classMode);
  }
  if (filename) {
    params.set("filename", filename);
  }
  return api(`/api/export?${params.toString()}`);
}

export function yoloExportUrl(
  projectId: number,
  exportType: YoloExportType,
  trainSplit = 80,
  scope: ExportScope = "all",
): string {
  return datasetExportUrl(projectId, exportType, trainSplit, "yolo", scope);
}

export function cocoExportUrl(
  projectId: number,
  exportType: DatasetExportType,
  trainSplit = 80,
  scope: ExportScope = "all",
): string {
  return datasetExportUrl(projectId, exportType, trainSplit, "coco", scope);
}

export function dinoExportUrl(projectId: number, scope: ExportScope = "all"): string {
  return datasetExportUrl(projectId, "full_tar", 100, "dino", scope);
}

async function fetchAndSaveTar(
  url: string,
  fallbackFilename: string,
  signal?: AbortSignal,
  onProgress?: (bytesLoaded: number) => void,
  initialLoaded = 0,
): Promise<number> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const message = await failMessage(res);
    if (res.status === 401 && message === "Sign in" && typeof window !== "undefined") {
      window.dispatchEvent(new Event("partlab-signed-out"));
    }
    throw new Error(message);
  }

  let blob: Blob;
  let fileLoaded = 0;
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(new Uint8Array(value));
        fileLoaded += value.byteLength;
        onProgress?.(initialLoaded + fileLoaded);
      }
    }
    blob = new Blob(chunks, { type: "application/x-tar" });
  } else {
    blob = await res.blob();
    fileLoaded = blob.size;
    onProgress?.(initialLoaded + fileLoaded);
  }

  const disposition = res.headers.get("content-disposition");
  let filename = fallbackFilename;
  if (disposition) {
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match?.[1]) filename = match[1];
  }

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

  return fileLoaded;
}

export async function downloadDatasetExport(options: DatasetExportOptions): Promise<void> {
  const {
    projectId,
    projectName,
    exportType,
    format = "yolo",
    trainSplit = 80,
    scope = "all",
    signal,
    onProgress,
    onStatusChange,
  } = options;

  const safeName = (projectName || "project").replace(/[^a-zA-Z0-9_-]/g, "_") || "project";

  if (format === "yolo_dino" || format === "coco_dino") {
    const baseFmt = format === "yolo_dino" ? "yolo" : "coco";
    const baseTarName = `${safeName}-${baseFmt}.tar`;
    const dinoTarName = `${safeName}-dino.tar`;

    onStatusChange?.(
      baseFmt === "yolo" ? "Streaming YOLO dataset (1 of 2)…" : "Streaming COCO dataset (1 of 2)…",
    );

    const baseTarUrl = datasetExportUrl(
      projectId,
      "full_tar",
      trainSplit,
      baseFmt,
      scope,
      "general",
      baseTarName,
    );
    const loadedBase = await fetchAndSaveTar(baseTarUrl, baseTarName, signal, onProgress, 0);

    await new Promise((resolve) => setTimeout(resolve, 300));

    onStatusChange?.("Streaming DINO catalogue (2 of 2)…");

    const dinoTarUrl = datasetExportUrl(
      projectId,
      "full_tar",
      100,
      "dino",
      scope,
      "ic",
      dinoTarName,
    );
    await fetchAndSaveTar(dinoTarUrl, dinoTarName, signal, onProgress, loadedBase);
    return;
  }

  let fallbackFilename =
    format === "coco"
      ? exportType === "labels_only"
        ? `${safeName}_coco_annotations.tar`
        : `${safeName}_coco.tar`
      : format === "dino"
        ? `${safeName}_dino_catalogue.tar`
        : format === "yolo-seg"
          ? exportType === "labels_only"
            ? `${safeName}_yolo_seg_labels.tar`
            : `${safeName}_yolo_seg.tar`
          : exportType === "labels_only"
            ? `${safeName}_yolo_labels.tar`
            : `${safeName}_yolo.tar`;

  if (options.filename) {
    fallbackFilename = options.filename;
  }

  const url = datasetExportUrl(
    projectId,
    exportType,
    trainSplit,
    format,
    scope,
    options.classMode,
    options.filename,
  );
  await fetchAndSaveTar(url, fallbackFilename, signal, onProgress, 0);
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

export function createClass(
  ic: string,
  des: string,
  part_type?: PartType | null,
): Promise<ClassRow> {
  return fetch(api("/api/classes"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ic,
      des,
      part_type: part_type && part_type !== "none" ? part_type : undefined,
    }),
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

export type UpdateClassInput = Pick<ClassRow, "id" | "ic" | "des"> &
  Partial<
    Pick<
      ClassRow,
      | "part_type"
      | "thread"
      | "length_mm"
      | "head_type"
      | "af_mm"
      | "height_mm"
      | "od_mm"
      | "id_mm"
      | "thickness_mm"
      | "width_mm"
      | "note"
      | "dimensions"
      | "dim1_name"
      | "dim1_mm"
      | "dim2_name"
      | "dim2_mm"
      | "dim3_name"
      | "dim3_mm"
    >
  >;

export function updateClass(row: UpdateClassInput): Promise<ClassRow> {
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

export function fetchPartTypes(includeArchived = false): Promise<PartTypeDefinition[]> {
  const query = includeArchived ? "?includeArchived=true" : "";
  return fetch(api(`/api/part-types${query}`)).then((res) => asJson<PartTypeDefinition[]>(res));
}

export function createPartType(data: {
  id?: string;
  name: string;
  fields: MetrologyField[];
  required_fields?: MetrologyField[];
  display_format?: string | null;
}): Promise<PartTypeDefinition> {
  return fetch(api("/api/part-types"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }).then((res) => asJson<PartTypeDefinition>(res));
}

export function updatePartType(data: {
  id: string;
  name?: string;
  fields?: MetrologyField[];
  required_fields?: MetrologyField[];
  display_format?: string | null;
  archived?: boolean;
}): Promise<PartTypeDefinition> {
  return fetch(api("/api/part-types"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }).then((res) => asJson<PartTypeDefinition>(res));
}

export async function deletePartType(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(api(`/api/part-types?id=${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
  return asJson<{ ok: boolean }>(res);
}

export type LabUser = { id: number; username: string; createdAt: string };

export function fetchMe(): Promise<{ id: number; username: string; admin?: boolean } | null> {
  return fetch(api("/api/me"))
    .then((res) => asJson<{ user: { id: number; username: string; admin?: boolean } | null }>(res))
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

export async function deleteImage(id: number): Promise<{ success: boolean; deletedId: number }> {
  const res = await fetch(api(`/api/images/${id}`), { method: "DELETE" });
  return asJson<{ success: boolean; deletedId: number }>(res);
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
  success?: boolean;
  ok?: boolean;
  locked_by?: string;
  locked_at?: string;
  is_claimed?: boolean;
  held_by?: string | null;
  held_minutes_remaining?: number;
}> {
  const res = await fetch(api("/api/claim"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, takeover, action: "claim" }),
  });
  return asJson(res);
}

export async function claimImageById(
  id: number,
  takeover = false,
): Promise<{
  success: boolean;
  ok: boolean;
  image?: unknown;
  id: number;
  name: string;
  file_path?: string;
  claimedBy: string;
  claimedAt: string;
  locked_by?: string;
  locked_at?: string;
  status: PhotoStatus;
  is_claimed?: boolean;
  held_by?: string | null;
  held_minutes_remaining?: number;
}> {
  const res = await fetch(api(`/api/images/${id}/claim`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ takeover }),
  });
  return asJson(res);
}

export async function releaseIncomplete(
  name: string,
  boxes?: Box[],
): Promise<{
  name: string;
  claimedBy: null;
  claimedAt: null;
  status: PhotoStatus;
  completedAt: null;
}> {
  const res = await fetch(api("/api/claim"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, action: "release-incomplete", boxes }),
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

export async function unlockApprovedImage(nameOrId: string | number): Promise<{
  ok: boolean;
  success: boolean;
  id: number;
  name: string;
  file_path: string;
  status: PhotoStatus;
  claimedBy: string;
  claimedAt: string;
  lockedBy: string;
  lockedAt: string;
  is_claimed: boolean;
  held_by: string;
  held_minutes_remaining: number;
  message?: string;
}> {
  const url =
    typeof nameOrId === "number"
      ? api(`/api/images/${nameOrId}/unlock`)
      : api("/api/images/unlock");
  const body =
    typeof nameOrId === "number"
      ? { id: nameOrId, action: "unlock-approved" }
      : { name: nameOrId, action: "unlock-approved" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return asJson(res);
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

export type ExifCheckResult = {
  projectName: string;
  totalImages: number;
  flaggedCount: number;
  flaggedFiles: string[];
};

export async function checkProjectExif(projectId: number): Promise<ExifCheckResult> {
  const res = await fetch(api("/api/project/check-exif"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: projectId }),
  });
  return asJson<ExifCheckResult>(res);
}

export type ReviewImageItem = {
  id: number;
  projectId: number;
  name: string;
  filePath: string;
  completedAt: string | null;
  completedBy: string | null;
  owner?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  boxes: Box[];
};

export type ReviewNextResult = {
  image: ReviewImageItem | null;
  pendingCount: number;
};

export async function fetchNextReviewImage(projectId?: number): Promise<ReviewNextResult> {
  const qs = projectId ? `?project_id=${projectId}` : "";
  const res = await fetch(api(`/api/images/review/next${qs}`));
  return asJson<ReviewNextResult>(res);
}

export type ReviewActionPayload = {
  project_id?: number;
  image_id?: number;
  name?: string;
  action: "approve" | "reject";
  boxes?: Box[];
};

export type ReviewActionResult = {
  ok: boolean;
  action: "approve" | "reject";
  nextImage: ReviewImageItem | null;
  pendingCount: number;
};

export async function submitReviewAction(
  payload: ReviewActionPayload,
): Promise<ReviewActionResult> {
  const res = await fetch(api("/api/images/review/action"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return asJson<ReviewActionResult>(res);
}

export type ClassHealthStatus = "healthy" | "low" | "missing";
export type ClassDimensionsStatus = "complete" | "missing" | "none";

export type ClassHealthStat = {
  id: number;
  name: string;
  description?: string;
  color?: string;
  count: number;
  percentage: number;
  status: ClassHealthStatus;
  dimensionsStatus?: ClassDimensionsStatus;
  part_type?: PartType | null;
  dim1_name?: string | null;
  dim1_mm?: number | null;
  dim2_name?: string | null;
  dim2_mm?: number | null;
  dim3_name?: string | null;
  dim3_mm?: number | null;
};

export type ProjectHealthSummary = {
  totalImages: number;
  completedImages: number;
  unlabeledImages: number;
  cleanImages: number;
  totalBoxes: number;
  missingDimensionsCount?: number;
};

export type DuplicateFileMeta = {
  relPath: string;
  status: string;
  boxesCount: number;
  hasTxt: boolean;
  size: number;
};

export type DuplicateGroup = {
  hash: string;
  kept: DuplicateFileMeta;
  extras: DuplicateFileMeta[];
};

export type DuplicateDetectionResult = {
  duplicateSets: number;
  totalDuplicates: number;
  totalTxtFiles: number;
  groups: DuplicateGroup[];
};

export type DuplicateCleanupLogItem = {
  relPath: string;
  imageDeleted: boolean;
  labelDeleted: boolean;
  hasTxt: boolean;
  status: string;
  kept: string;
  hash: string;
};

export type DuplicateCleanupResult = {
  ok: boolean;
  removedCount: number;
  removed: DuplicateCleanupLogItem[];
  message: string;
};

export type ProjectHealthResult = {
  projectName: string;
  projectId?: number;
  summary: ProjectHealthSummary;
  classes: ClassHealthStat[];
  duplicates?: DuplicateDetectionResult | null;
};

export async function fetchProjectHealth(projectId?: number): Promise<ProjectHealthResult> {
  const qs = projectId ? `?id=${projectId}` : "";
  const res = await fetch(api(`/api/project/health${qs}`));
  return asJson<ProjectHealthResult>(res);
}

export type SyncImagesResult = {
  ok: boolean;
  projectName: string;
  projectId: number;
  newlyAdded: number;
  pruned: number;
  prunedUnlabeled: number;
  missingCompleted: number;
  restored: number;
  totalInProject: number;
  duplicates?: DuplicateDetectionResult | null;
};

export async function syncProjectImages(projectId: number): Promise<SyncImagesResult> {
  const res = await fetch(api(`/api/projects/${projectId}/sync-images`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  return asJson<SyncImagesResult>(res);
}

export const rescanProjectImages = syncProjectImages;

export async function fetchProjectDuplicates(
  projectId?: number,
): Promise<DuplicateDetectionResult> {
  const qs = projectId ? `?id=${projectId}` : "";
  const res = await fetch(api(`/api/project/duplicates${qs}`));
  return asJson<DuplicateDetectionResult>(res);
}

export async function cleanupProjectDuplicates(
  projectId?: number,
): Promise<DuplicateCleanupResult> {
  const res = await fetch(api("/api/project/cleanup-duplicates"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(projectId ? { id: projectId, projectId } : {}),
  });
  return asJson<DuplicateCleanupResult>(res);
}

export type BackupStatusResult = {
  activeCount: number;
  activeUsers: string[];
};

export async function fetchBackupStatus(): Promise<BackupStatusResult> {
  const res = await fetch(api("/api/system/backup-status"));
  return asJson<BackupStatusResult>(res);
}

export function getBackupDownloadUrl(): string {
  return api("/api/system/backup-download");
}

export async function downloadDatabaseBackup(onProgress?: (bytes: number) => void): Promise<void> {
  const res = await fetch(getBackupDownloadUrl());
  if (!res.ok) {
    const message = await failMessage(res);
    throw new Error(message || "Failed to download database backup");
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
    blob = new Blob(chunks, { type: "application/sql" });
  } else {
    blob = await res.blob();
    onProgress?.(blob.size);
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const disposition = res.headers.get("content-disposition");
  let filename = "ls-marker-backup.sql";
  if (disposition) {
    const match = disposition.match(/filename="?([^";]+)"?/);
    if (match?.[1]) filename = match[1];
  }
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export type MaintenanceStatus = {
  maintenance: boolean;
  message?: string;
};

export async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  const res = await fetch(api("/api/system/maintenance"));
  return asJson<MaintenanceStatus>(res);
}

export async function setMaintenanceMode(
  enabled: boolean,
  message?: string,
): Promise<{ success: boolean; maintenance: boolean; message?: string }> {
  const res = await fetch(api("/api/system/maintenance"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled, message }),
  });
  return asJson(res);
}

export type AiSettings = {
  enabled: boolean;
};

export async function fetchAiSettings(): Promise<AiSettings> {
  const res = await fetch(api("/api/system/ai-settings"));
  return asJson<AiSettings>(res);
}

export async function setAiSettings(
  enabled: boolean,
): Promise<{ success: boolean; enabled: boolean }> {
  const res = await fetch(api("/api/system/ai-settings"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return asJson(res);
}

export type DbConnectionInfo = {
  host: string;
  port: string;
  database: string;
  user: string;
  source: string;
  maskedUrl: string;
};

export async function fetchDbConfig(): Promise<{ info: DbConnectionInfo }> {
  const res = await fetch(api("/api/system/db-config"));
  return asJson<{ info: DbConnectionInfo }>(res);
}

export async function testDbConnection(url: string): Promise<{
  ok: boolean;
  version?: string;
  database?: string;
  latencyMs?: number;
  error?: string;
}> {
  const res = await fetch(api("/api/system/db-test"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return asJson(res);
}

export async function updateDbConfig(
  url: string,
): Promise<{ success: boolean; info: DbConnectionInfo }> {
  const res = await fetch(api("/api/system/db-config"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return asJson(res);
}

export type GitPullResult = {
  ok: boolean;
  success: boolean;
  output: string;
  restarting: boolean;
  packageJsonChanged?: boolean;
  installed?: boolean;
  message: string;
};

export async function executeGitPull(
  options: { restart?: boolean; install?: boolean } | boolean = true,
): Promise<GitPullResult> {
  const opts = typeof options === "boolean" ? { restart: options } : options;
  const res = await fetch(api("/api/system/git-pull"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      restart: opts.restart !== false,
      install: opts.install ?? false,
    }),
  });
  return asJson(res);
}

export async function executeServerRestart(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(api("/api/system/restart-server"), {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  return asJson(res);
}

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CropInfo = {
  isCropped: boolean;
  original?: { width: number; height: number } | null;
  current: { width: number; height: number };
};

export type CropResult = {
  ok: boolean;
  width: number;
  height: number;
  boxes: Box[];
};

export async function fetchCropInfo(name: string): Promise<CropInfo> {
  const res = await fetch(api(`/api/image/crop-info?name=${encodeURIComponent(name)}`));
  return asJson<CropInfo>(res);
}

export async function cropImage(name: string, rect: CropRect): Promise<CropResult> {
  const res = await fetch(api("/api/image/crop"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, rect }),
  });
  return asJson<CropResult>(res);
}

export async function uncropImage(name: string): Promise<{ ok: boolean; boxes: Box[] }> {
  const res = await fetch(api("/api/image/uncrop"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return asJson<{ ok: boolean; boxes: Box[] }>(res);
}

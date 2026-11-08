import {
  Archive,
  Check,
  Database,
  Download,
  Edit2,
  FolderOpen,
  Layers,
  Loader2,
  Lock,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Server,
  Sparkles,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { BackupModal } from "@/components/backup-modal";
import { DatasetHealthModal } from "@/components/dataset-health-modal";
import { DuplicateCleanupModal } from "@/components/duplicate-cleanup-modal";
import { MaintenanceModal } from "@/components/maintenance-modal";
import { RescanModal } from "@/components/rescan-modal";
import {
  areAllSamModelsCached,
  CACHE_NAME,
  clearSamModelCacheAndReset,
} from "@/services/samService";
import {
  ALL_METROLOGY_FIELDS,
  checkProjectExif,
  createPartType,
  createUser,
  deleteProject,
  deleteUser,
  downloadDatasetExport,
  fetchAdmin,
  fetchAiSettings,
  fetchDbConfig,
  fetchMaintenanceStatus,
  fetchPartTypes,
  fetchProjectHealth,
  fetchProjects,
  fetchUsers,
  lockAdmin,
  resetUserPassword,
  setAiSettings,
  setMaintenanceMode,
  syncProjectImages,
  testDbConnection,
  unlockAdmin,
  updateDbConfig,
  updatePartType,
  type DatasetExportType,
  type DbConnectionInfo,
  type DuplicateDetectionResult,
  type ExifCheckResult,
  type ExportFormat,
  type ExportScope,
  type LabUser,
  type MetrologyField,
  type PartTypeDefinition,
  type Project,
  type ProjectHealthResult,
  type SyncImagesResult,
} from "@/lib/label-client";
import { useProject } from "@/lib/project";

type SettingsTab = "projects" | "classes" | "export" | "database" | "ai" | "users";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

const CLASS_PRESET_TEMPLATES: Array<{
  id: string;
  name: string;
  fields: MetrologyField[];
  required: MetrologyField[];
  format: string;
  lengthRule: string;
  diameterRule: string;
  note: string;
}> = [
  {
    id: "bolt",
    name: "Bolt",
    fields: ["thread", "length_mm", "head_type", "af_mm"],
    required: ["thread", "length_mm"],
    format: "{thread}x{length_mm} ({head_type})",
    lengthRule: "length_mm",
    diameterRule: "thread",
    note: "Shank length and nominal thread diameter",
  },
  {
    id: "nut",
    name: "Nut",
    fields: ["thread", "af_mm", "height_mm"],
    required: ["thread", "height_mm"],
    format: "{thread} AF:{af_mm} H:{height_mm}",
    lengthRule: "height_mm",
    diameterRule: "af_mm",
    note: "Height and across-flats width",
  },
  {
    id: "washer",
    name: "Washer",
    fields: ["od_mm", "id_mm", "thickness_mm"],
    required: ["od_mm", "thickness_mm"],
    format: "OD:{od_mm} ID:{id_mm} T:{thickness_mm}",
    lengthRule: "thickness_mm",
    diameterRule: "od_mm",
    note: "Thickness and outer diameter",
  },
  {
    id: "label",
    name: "Label",
    fields: ["width_mm", "height_mm", "note"],
    required: ["width_mm", "height_mm"],
    format: "{width_mm}x{height_mm}mm",
    lengthRule: "height_mm",
    diameterRule: "width_mm",
    note: "Height and width bounds",
  },
  {
    id: "cable_tie",
    name: "Cable tie",
    fields: ["width_mm", "length_mm", "note"],
    required: ["width_mm", "length_mm"],
    format: "{width_mm}x{length_mm}mm",
    lengthRule: "length_mm",
    diameterRule: "width_mm",
    note: "Length and strip width",
  },
  {
    id: "spring",
    name: "Spring",
    fields: ["od_mm", "length_mm", "id_mm", "thickness_mm"],
    required: ["od_mm", "length_mm"],
    format: "OD:{od_mm} L:{length_mm}",
    lengthRule: "length_mm",
    diameterRule: "od_mm",
    note: "Free length and outer diameter",
  },
  {
    id: "resin",
    name: "Resin",
    fields: ["width_mm", "height_mm", "thickness_mm", "note"],
    required: ["width_mm", "height_mm"],
    format: "{width_mm}x{height_mm}mm",
    lengthRule: "height_mm",
    diameterRule: "width_mm",
    note: "Overall patch dimensions",
  },
];

export function SettingsPage() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>("projects");

  const [users, setUsers] = useState<LabUser[] | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [username, setUsername] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [nextPassword, setNextPassword] = useState("");
  const [pendingDeleteUserId, setPendingDeleteUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Export State
  const [projectToExport, setProjectToExport] = useState<Project | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("yolo");
  const [exportType, setExportType] = useState<DatasetExportType>("labels_only");
  const [exportScope, setExportScope] = useState<ExportScope>("all");
  const [trainSplit, setTrainSplit] = useState<number>(80);
  const [isExporting, setIsExporting] = useState(false);
  const [bytesExported, setBytesExported] = useState(0);
  const [exportStatusText, setExportStatusText] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  // Diagnostics & Modals State
  const [checkingExifProjectId, setCheckingExifProjectId] = useState<number | null>(null);
  const [exifResult, setExifResult] = useState<ExifCheckResult | null>(null);

  const [checkingHealthProjectId, setCheckingHealthProjectId] = useState<number | null>(null);
  const [healthResult, setHealthResult] = useState<ProjectHealthResult | null>(null);

  const [syncingProjectId, setSyncingProjectId] = useState<number | null>(null);
  const [syncResult, setSyncResult] = useState<SyncImagesResult | null>(null);

  const [duplicatesResult, setDuplicatesResult] = useState<DuplicateDetectionResult | null>(null);

  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState(false);
  const [isMaintenance, setIsMaintenance] = useState(false);

  const [samCached, setSamCached] = useState<boolean>(false);
  const [samCacheMessage, setSamCacheMessage] = useState<string | null>(null);
  const [clearingSamCache, setClearingSamCache] = useState(false);

  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [togglingAi, setTogglingAi] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  const [dbConfig, setDbConfig] = useState<DbConnectionInfo | null>(null);
  const [showDbEditor, setShowDbEditor] = useState(false);
  const [candidateUrl, setCandidateUrl] = useState("");
  const [testingDb, setTestingDb] = useState(false);
  const [testDbResult, setTestDbResult] = useState<{
    ok: boolean;
    version?: string;
    database?: string;
    latencyMs?: number;
    error?: string;
  } | null>(null);
  const [updatingDb, setUpdatingDb] = useState(false);
  const [updateDbMessage, setUpdateDbMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Part Classes State
  const [partTypes, setPartTypes] = useState<PartTypeDefinition[] | null>(null);
  const [loadingPartTypes, setLoadingPartTypes] = useState(false);
  const [showArchivedClasses, setShowArchivedClasses] = useState(false);
  const [isAddingClass, setIsAddingClass] = useState(false);
  const [editingPartTypeId, setEditingPartTypeId] = useState<string | null>(null);

  const [classFormName, setClassFormName] = useState("");
  const [classFormId, setClassFormId] = useState("");
  const [classFormFields, setClassFormFields] = useState<MetrologyField[]>([]);
  const [classFormRequired, setClassFormRequired] = useState<MetrologyField[]>([]);
  const [classFormFormat, setClassFormFormat] = useState("");
  const [classFormLengthRule, setClassFormLengthRule] = useState("");
  const [classFormDiameterRule, setClassFormDiameterRule] = useState("");
  const [classFormRuleNote, setClassFormRuleNote] = useState("");
  const [classFormError, setClassFormError] = useState<string | null>(null);
  const [classFormSaving, setClassFormSaving] = useState(false);

  const { current: project } = useProject();

  useEffect(() => {
    let cancel = false;
    fetchAdmin()
      .then((open) => {
        if (!cancel) setUnlocked(open);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not check admin access");
      });
    fetchMaintenanceStatus()
      .then((res) => {
        if (!cancel) setIsMaintenance(res.maintenance);
      })
      .catch(() => {});
    areAllSamModelsCached()
      .then((cached) => {
        if (!cancel) setSamCached(cached);
      })
      .catch(() => {});
    fetchAiSettings()
      .then((res) => {
        if (!cancel) setAiEnabled(res.enabled);
      })
      .catch(() => {});
    fetchDbConfig()
      .then((res) => {
        if (!cancel) {
          setDbConfig(res.info);
          setCandidateUrl(res.info.maskedUrl);
        }
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    let cancel = false;
    Promise.all([
      fetchUsers(),
      fetchProjects(),
      project?.id ? fetchPartTypes(true, project.id).catch(() => []) : Promise.resolve([]),
    ])
      .then(([userRows, projectRows, ptRows]) => {
        if (cancel) return;
        setUsers(userRows);
        setProjects(projectRows);
        setPartTypes(ptRows);
        if (projectRows.length > 0 && !projectToExport) {
          setProjectToExport(projectRows.find((p) => p.id === project?.id) ?? projectRows[0]);
        }
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load settings");
      });
    return () => {
      cancel = true;
    };
  }, [unlocked, project?.id, projectToExport]);

  async function reloadPartTypes(targetProjectId?: number) {
    const projId = targetProjectId ?? project?.id;
    if (!projId) {
      setPartTypes([]);
      return;
    }
    setLoadingPartTypes(true);
    try {
      const list = await fetchPartTypes(true, projId);
      setPartTypes(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load part classes");
    } finally {
      setLoadingPartTypes(false);
    }
  }

  function handleStartAddClass() {
    setIsAddingClass(true);
    setEditingPartTypeId(null);
    setClassFormName("");
    setClassFormId("");
    setClassFormFields(["width_mm", "height_mm"]);
    setClassFormRequired(["width_mm", "height_mm"]);
    setClassFormFormat("{width_mm}x{height_mm}mm");
    setClassFormLengthRule("height_mm");
    setClassFormDiameterRule("width_mm");
    setClassFormRuleNote("");
    setClassFormError(null);
  }

  function handleApplyTemplate(templateId: string) {
    const tmpl = CLASS_PRESET_TEMPLATES.find((t) => t.id === templateId);
    if (!tmpl) return;
    setClassFormName(tmpl.name);
    setClassFormId(tmpl.id);
    setClassFormFields([...tmpl.fields]);
    setClassFormRequired([...tmpl.required]);
    setClassFormFormat(tmpl.format);
    setClassFormLengthRule(tmpl.lengthRule);
    setClassFormDiameterRule(tmpl.diameterRule);
    setClassFormRuleNote(tmpl.note);
  }

  function handleStartEditClass(pt: PartTypeDefinition) {
    setIsAddingClass(false);
    setEditingPartTypeId(pt.id);
    setClassFormName(pt.name);
    setClassFormId(pt.id);
    setClassFormFields([...pt.fields]);
    setClassFormRequired([...pt.required_fields]);
    setClassFormFormat(pt.display_format || "");
    setClassFormLengthRule(pt.length_rule || "");
    setClassFormDiameterRule(pt.diameter_rule || "");
    setClassFormRuleNote(pt.note || "");
    setClassFormError(null);
  }

  function handleCancelClassForm() {
    setIsAddingClass(false);
    setEditingPartTypeId(null);
    setClassFormError(null);
  }

  function handleToggleField(fieldKey: MetrologyField) {
    if (classFormFields.includes(fieldKey)) {
      setClassFormFields((prev) => prev.filter((f) => f !== fieldKey));
      setClassFormRequired((prev) => prev.filter((f) => f !== fieldKey));
    } else {
      setClassFormFields((prev) => [...prev, fieldKey]);
    }
  }

  function handleToggleRequired(fieldKey: MetrologyField) {
    if (classFormRequired.includes(fieldKey)) {
      setClassFormRequired((prev) => prev.filter((f) => f !== fieldKey));
    } else {
      setClassFormRequired((prev) => [...prev, fieldKey]);
      if (!classFormFields.includes(fieldKey)) {
        setClassFormFields((prev) => [...prev, fieldKey]);
      }
    }
  }

  async function handleSaveClass() {
    if (!project?.id) {
      setClassFormError("Please open or select an active project to create or edit classes.");
      return;
    }
    if (!classFormName.trim()) {
      setClassFormError("Class name is required");
      return;
    }
    setClassFormSaving(true);
    setClassFormError(null);
    try {
      if (isAddingClass) {
        const id =
          classFormId
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "_") || undefined;
        await createPartType({
          id,
          projectId: project.id,
          name: classFormName.trim(),
          fields: classFormFields,
          required_fields: classFormRequired,
          display_format: classFormFormat.trim() || null,
          length_rule: classFormLengthRule.trim() || null,
          diameter_rule: classFormDiameterRule.trim() || null,
          note: classFormRuleNote.trim() || null,
        });
      } else if (editingPartTypeId) {
        await updatePartType({
          id: editingPartTypeId,
          projectId: project.id,
          name: classFormName.trim(),
          fields: classFormFields,
          required_fields: classFormRequired,
          display_format: classFormFormat.trim() || null,
          length_rule: classFormLengthRule.trim() || null,
          diameter_rule: classFormDiameterRule.trim() || null,
          note: classFormRuleNote.trim() || null,
        });
      }
      setIsAddingClass(false);
      setEditingPartTypeId(null);
      await reloadPartTypes(project.id);
    } catch (err: unknown) {
      setClassFormError(err instanceof Error ? err.message : "Failed to save part class");
    } finally {
      setClassFormSaving(false);
    }
  }

  async function handleToggleArchive(pt: PartTypeDefinition) {
    try {
      await updatePartType({
        id: pt.id,
        projectId: project?.id,
        archived: !pt.archived,
      });
      await reloadPartTypes(project?.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update archive status");
    }
  }

  async function handleClearSamCache() {
    setClearingSamCache(true);
    setSamCacheMessage(null);
    try {
      const deleted = await clearSamModelCacheAndReset();
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("ls_marker_sam2_notice_seen");
      }
      setSamCached(false);
      setSamCacheMessage(
        deleted
          ? `Cleared local model cache (${CACHE_NAME}). Models will re-download on next Trace.`
          : `Model cache (${CACHE_NAME}) was already empty.`,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to clear SAM 2.1 model cache");
    } finally {
      setClearingSamCache(false);
    }
  }

  async function handleToggleMaintenance(enabled: boolean) {
    const res = await setMaintenanceMode(enabled);
    setIsMaintenance(res.maintenance);
  }

  async function handleToggleAi() {
    setTogglingAi(true);
    setAiMessage(null);
    try {
      const next = !aiEnabled;
      const res = await setAiSettings(next);
      setAiEnabled(res.enabled);
      setAiMessage(
        res.enabled
          ? "SAM 2.1 AI Auto-Trace enabled. Tool icon is visible in Label menu."
          : "SAM 2.1 AI Auto-Trace disabled. Tool icon is hidden from Label menu and access is blocked.",
      );
    } catch (err: unknown) {
      setAiMessage(err instanceof Error ? err.message : "Failed to update AI settings");
    } finally {
      setTogglingAi(false);
    }
  }

  async function handleTestDbConnection() {
    if (!candidateUrl.trim()) return;
    setTestingDb(true);
    setTestDbResult(null);
    setUpdateDbMessage(null);
    try {
      const res = await testDbConnection(candidateUrl.trim());
      setTestDbResult(res);
    } catch (err: unknown) {
      setTestDbResult({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to test connection",
      });
    } finally {
      setTestingDb(false);
    }
  }

  async function handleApplyDbConfig() {
    if (!candidateUrl.trim()) return;
    setUpdatingDb(true);
    setUpdateDbMessage(null);
    try {
      const res = await updateDbConfig(candidateUrl.trim());
      setDbConfig(res.info);
      setCandidateUrl(res.info.maskedUrl);
      setUpdateDbMessage({
        type: "success",
        text: `Database configuration updated successfully. Connected to ${res.info.host}:${res.info.port}/${res.info.database}.`,
      });
      setShowDbEditor(false);
    } catch (err: unknown) {
      setUpdateDbMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update database configuration",
      });
    } finally {
      setUpdatingDb(false);
    }
  }

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartExport() {
    if (!projectToExport || isExporting) return;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setIsExporting(true);
    setBytesExported(0);
    setExportStatusText(null);
    setExportError(null);
    const isDual =
      exportFormat === "dino" || exportFormat === "yolo_dino" || exportFormat === "coco_dino";
    try {
      await downloadDatasetExport({
        projectId: projectToExport.id,
        projectName: projectToExport.name,
        format: exportFormat,
        exportType: isDual ? "full_tar" : exportType,
        trainSplit: exportFormat === "dino" ? 100 : trainSplit,
        scope: exportScope,
        signal: controller.signal,
        onProgress: (loaded) => setBytesExported(loaded),
        onStatusChange: (status) => setExportStatusText(status),
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      exportAbortRef.current = null;
      setIsExporting(false);
      setExportStatusText(null);
    }
  }

  async function handleDeleteProject() {
    if (!projectToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProject(projectToDelete.id, adminPassword);
      setProjectToDelete(null);
      setAdminPassword("");
      const nextProjects = await fetchProjects();
      setProjects(nextProjects);
      if (project?.id === projectToDelete.id) {
        window.location.reload();
      }
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete project");
    } finally {
      setDeleting(false);
    }
  }

  async function handleCheckExif(p: Project) {
    setCheckingExifProjectId(p.id);
    setError(null);
    try {
      const result = await checkProjectExif(p.id);
      setExifResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to check EXIF");
    } finally {
      setCheckingExifProjectId(null);
    }
  }

  async function handleCheckHealth(p: Project) {
    setCheckingHealthProjectId(p.id);
    setError(null);
    try {
      const result = await fetchProjectHealth(p.id);
      setHealthResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load project health");
    } finally {
      setCheckingHealthProjectId(null);
    }
  }

  async function handleRescan(p: Project) {
    setSyncingProjectId(p.id);
    setError(null);
    try {
      const result = await syncProjectImages(p.id);
      setSyncResult(result);
      const nextProjects = await fetchProjects();
      setProjects(nextProjects);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Rescan failed");
    } finally {
      setSyncingProjectId(null);
    }
  }

  const tabClass = (tab: SettingsTab) =>
    `h-7 px-2.5 flex items-center gap-1.5 text-xs font-medium text-left transition-colors border-l-2 whitespace-nowrap ${
      activeTab === tab
        ? "border-[#1473e6] bg-[#1473e6]/10 text-[#1473e6] font-semibold"
        : "border-transparent text-[#707070] hover:text-[#282828] hover:bg-[#f0f0f0]"
    }`;

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#f0f0f0] text-[#282828] select-none text-xs">
      {/* 28px Top Bar */}
      <AppHeader
        current="settings"
        meta={
          unlocked ? (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-emerald-800 bg-emerald-100 border border-emerald-300 px-1.5 py-0.2 rounded-[2px] font-semibold flex items-center gap-1">
                <Check className="size-3 text-emerald-700" />
                Admin Unlocked
              </span>
              <button
                type="button"
                onClick={() => {
                  void run(async () => {
                    await lockAdmin();
                    setUnlocked(false);
                    setUsers(null);
                    setProjects(null);
                  });
                }}
                className="press h-5 px-1.5 rounded-[2px] border border-[#c8c8c8] bg-white text-[#707070] hover:text-[#282828] text-[10px] font-mono flex items-center gap-1"
                title="Lock admin access"
              >
                <Lock className="size-2.5" />
                <span>Lock</span>
              </button>
            </div>
          ) : (
            <span className="font-mono text-[10px] text-amber-900 bg-amber-100 border border-amber-300 px-1.5 py-0.2 rounded-[2px] font-semibold flex items-center gap-1">
              <Lock className="size-2.5 text-amber-700" />
              Admin Locked
            </span>
          )
        }
      />

      {/* Main Container */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {error && (
          <div className="p-1.5 bg-red-50 border-b border-red-200 text-red-800 text-xs flex items-center justify-between shrink-0">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {unlocked === false ? (
          /* Admin Password Gate (Centered Compact Card) */
          <div className="flex-1 flex items-center justify-center p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await unlockAdmin(password);
                  setPassword("");
                  setUnlocked(true);
                });
              }}
              className="w-80 bg-white border border-[#c8c8c8] rounded-[2px] p-4 flex flex-col gap-3 shadow-none"
            >
              <div className="flex items-center gap-2 text-[#282828]">
                <Lock className="size-4 text-[#1473e6]" />
                <h2 className="text-xs font-semibold uppercase tracking-wider">
                  Admin Authentication
                </h2>
              </div>
              <p className="text-[11px] text-[#707070] leading-relaxed">
                Shared admin password required for projects, users, backups, and maintenance
                settings.
              </p>
              <div>
                <input
                  type="password"
                  placeholder="Admin password (admin)"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full h-7 px-2 rounded-[2px] border border-[#c8c8c8] bg-white text-xs outline-none focus:border-[#1473e6]"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="press h-7 rounded-[2px] bg-[#1473e6] text-white font-medium text-xs hover:bg-[#0d62c7] disabled:opacity-40"
              >
                {busy ? "Unlocking..." : "Unlock Admin Settings"}
              </button>
            </form>
          </div>
        ) : unlocked ? (
          /* Multi-Pane Tabbed Workspace */
          <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
            {/* Left Tabs Strip (210px) */}
            <aside
              aria-label="Settings Categories"
              className="w-[210px] border-r border-[#c8c8c8] bg-white flex flex-col shrink-0 py-1 select-none"
            >
              <button
                type="button"
                onClick={() => setActiveTab("projects")}
                className={tabClass("projects")}
              >
                <FolderOpen className="size-3.5" />
                <span>Projects &amp; Sync</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("classes")}
                className={tabClass("classes")}
              >
                <Layers className="size-3.5" />
                <span>Part Classes</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("export")}
                className={tabClass("export")}
              >
                <Download className="size-3.5" />
                <span>Dataset Export</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("database")}
                className={tabClass("database")}
              >
                <Database className="size-3.5" />
                <span>Database &amp; Maintenance</span>
              </button>
              <button type="button" onClick={() => setActiveTab("ai")} className={tabClass("ai")}>
                <Sparkles className="size-3.5" />
                <span>AI Models &amp; Cache</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("users")}
                className={tabClass("users")}
              >
                <Users className="size-3.5" />
                <span>Labeller Users</span>
              </button>
            </aside>

            {/* Main Content Workspace Panel */}
            <main className="flex-1 min-w-0 min-h-0 bg-[#f0f0f0] p-2 overflow-y-auto">
              {/* TAB 1: PROJECTS & SYNC */}
              {activeTab === "projects" && (
                <div className="flex flex-col gap-2">
                  <div className="bg-white border border-[#c8c8c8] rounded-[2px] p-2.5">
                    <h2 className="text-xs font-semibold text-[#282828] mb-1">Project Directory</h2>
                    <p className="text-[11px] text-[#707070] mb-2">
                      Manage scan roots, synchronize disk changes without data loss, and verify
                      dataset integrity.
                    </p>

                    <div className="overflow-x-auto border border-[#c8c8c8] rounded-[2px]">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-[#c8c8c8] bg-[#f5f5f5] text-[11px] font-semibold text-[#707070]">
                            <th className="px-2 py-1.5">Project</th>
                            <th className="px-2 py-1.5">Disk Path</th>
                            <th className="px-2 py-1.5">Photos (Done / Total)</th>
                            <th className="px-2 py-1.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f0f0f0]">
                          {(projects ?? []).map((p) => (
                            <tr key={p.id} className="hover:bg-[#f9f9f9]">
                              <td className="px-2 py-1.5 font-bold text-[#282828]">
                                <div className="flex items-center gap-1.5">
                                  <span>{p.name}</span>
                                  {project?.id === p.id && (
                                    <span className="font-mono text-[9px] bg-blue-100 text-blue-800 px-1 rounded-[2px]">
                                      active
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 font-mono text-[11px] text-[#707070] truncate max-w-xs">
                                {p.folder}
                              </td>
                              <td className="px-2 py-1.5 font-mono text-[11px]">
                                {p.folderOk ? (
                                  <span>
                                    <strong className="text-emerald-700">
                                      {p.completePhotos ?? 0}
                                    </strong>{" "}
                                    / {p.totalPhotos ?? 0}
                                    {p.approvedPhotos ? (
                                      <span className="ml-1 text-purple-700">
                                        ({p.approvedPhotos} approved)
                                      </span>
                                    ) : null}
                                  </span>
                                ) : (
                                  <span className="text-red-600 font-sans">Folder missing</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setProjectToExport(p);
                                      setActiveTab("export");
                                    }}
                                    className="press h-5 px-1.5 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-[#282828] text-[10px]"
                                  >
                                    Export
                                  </button>
                                  <button
                                    type="button"
                                    disabled={checkingExifProjectId === p.id}
                                    onClick={() => void handleCheckExif(p)}
                                    className="press h-5 px-1.5 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-[#282828] text-[10px] disabled:opacity-40"
                                  >
                                    {checkingExifProjectId === p.id ? "Checking..." : "EXIF"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={checkingHealthProjectId === p.id}
                                    onClick={() => void handleCheckHealth(p)}
                                    className="press h-5 px-1.5 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-[#282828] text-[10px] disabled:opacity-40"
                                  >
                                    {checkingHealthProjectId === p.id ? "Loading..." : "Health"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={syncingProjectId === p.id}
                                    onClick={() => void handleRescan(p)}
                                    className="press h-5 px-1.5 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-[#282828] text-[10px] disabled:opacity-40"
                                  >
                                    {syncingProjectId === p.id ? "Rescanning..." : "Rescan"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setProjectToDelete(p);
                                      setAdminPassword("");
                                      setDeleteError(null);
                                    }}
                                    className="press h-5 px-1.5 rounded-[2px] border border-red-200 text-red-600 hover:bg-red-50 text-[10px]"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* EXIF Check Popover/Result */}
                  {exifResult && (
                    <div className="bg-white border border-[#c8c8c8] rounded-[2px] p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs text-[#282828]">
                          EXIF Check: {exifResult.projectName}
                        </span>
                        <button type="button" onClick={() => setExifResult(null)}>
                          <X className="size-3.5 text-[#707070]" />
                        </button>
                      </div>
                      <p className="text-[11px] text-[#707070] mb-2">
                        {exifResult.flaggedCount === 0
                          ? `All ${exifResult.totalImages} images have clean orientation tags (Orientation 1).`
                          : `Warning: ${exifResult.flaggedCount} of ${exifResult.totalImages} images have orientation transforms that may cause rotation shifts.`}
                      </p>
                      {exifResult.flaggedFiles.length > 0 && (
                        <div className="max-h-24 overflow-y-auto font-mono text-[10px] bg-[#f9f9f9] p-1.5 border border-[#e5e5e5] rounded-[2px]">
                          {exifResult.flaggedFiles.map((f) => (
                            <div key={f} className="text-amber-800">
                              {f}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB: PART CLASSES */}
              {activeTab === "classes" && (
                <div className="flex flex-col gap-2">
                  <div className="bg-white border border-[#c8c8c8] rounded-[2px] p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <h2 className="text-xs font-semibold text-[#282828]">
                          Part Classes &amp; Metrology Definitions
                        </h2>
                        {loadingPartTypes && (
                          <Loader2 className="size-3 animate-spin text-[#1473e6]" />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-[11px] text-[#707070] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showArchivedClasses}
                            onChange={(e) => setShowArchivedClasses(e.target.checked)}
                            className="size-3 rounded-[2px]"
                          />
                          <span>Show archived</span>
                        </label>
                        {!isAddingClass && !editingPartTypeId && (
                          <button
                            type="button"
                            onClick={handleStartAddClass}
                            disabled={!project}
                            className="press inline-flex items-center gap-1 px-2 py-1 rounded-[2px] bg-[#1473e6] text-white text-[11px] font-medium hover:bg-[#0d62c7] disabled:opacity-40"
                            title={
                              !project
                                ? "Please select a project first"
                                : "Add a class to this project"
                            }
                          >
                            <Plus className="size-3" />
                            <span>Add Class</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {project ? (
                      <div className="flex items-center gap-2 mb-2 p-1.5 bg-blue-50/60 border border-blue-200/60 rounded-[2px] text-[11px] text-[#282828]">
                        <span className="text-[#707070]">Project Scope:</span>
                        <span className="font-semibold">{project.name}</span>
                        <span className="font-mono text-[9px] bg-white border border-[#c8c8c8] text-[#505050] px-1 py-0.5 rounded-[2px]">
                          ID: {project.id}
                        </span>
                        <span className="text-[10px] text-[#707070] ml-auto">
                          Classes and measurement rules apply only to this project.
                        </span>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-[2px] mb-3">
                        <strong>No project is currently active.</strong> Classes are scoped to
                        individual projects. Please open or select a project from the top navigation
                        bar to manage its classes.
                      </div>
                    )}

                    <p className="text-[11px] text-[#707070] mb-3">
                      Define the component classes (Bolt, Nut, Resin, etc.) available for this
                      project during labelling. Control which structured measurement fields (thread,
                      length, AF, diameter, etc.) are shown and required for each class.
                    </p>

                    {/* ADD / EDIT CLASS FORM */}
                    {(isAddingClass || editingPartTypeId) && (
                      <div className="mb-3 p-3 bg-[#f9f9f9] border border-[#c8c8c8] rounded-[2px] flex flex-col gap-3">
                        <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-2">
                          <span className="text-xs font-bold text-[#282828]">
                            {isAddingClass
                              ? "Create New Part Class"
                              : `Edit Part Class: ${classFormName}`}
                          </span>
                          <button
                            type="button"
                            onClick={handleCancelClassForm}
                            className="size-5 inline-flex items-center justify-center text-[#707070] hover:text-[#282828]"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>

                        {/* QUICK PRESET PICKER */}
                        {isAddingClass && (
                          <div className="flex items-center gap-2 pb-2 border-b border-[#e5e5e5]">
                            <span className="text-[11px] font-semibold text-[#505050]">
                              Quick Template:
                            </span>
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) handleApplyTemplate(e.target.value);
                              }}
                              className="h-6 px-2 text-[11px] rounded-[2px] border border-[#c8c8c8] bg-white text-[#505050]"
                            >
                              <option value="">
                                Choose a template to prefill (Bolt, Nut, Washer, Resin...)
                              </option>
                              {CLASS_PRESET_TEMPLATES.map((tmpl) => (
                                <option key={tmpl.id} value={tmpl.id}>
                                  {tmpl.name} ({tmpl.fields.join(", ")})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {classFormError && (
                          <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-[2px]">
                            {classFormError}
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div>
                            <label className="text-[11px] font-semibold text-[#505050] block mb-1">
                              Class Name *
                            </label>
                            <input
                              type="text"
                              value={classFormName}
                              onChange={(e) => {
                                const nextName = e.target.value;
                                setClassFormName(nextName);
                                if (isAddingClass) {
                                  setClassFormId(
                                    nextName
                                      .toLowerCase()
                                      .replace(/[^a-z0-9_]/g, "_")
                                      .replace(/_+/g, "_")
                                      .replace(/^_+|_+$/g, ""),
                                  );
                                }
                              }}
                              placeholder="e.g. Resin, Circlip, Dowel pin"
                              className="w-full h-7 px-2 rounded-[2px] border border-[#c8c8c8] bg-white text-xs outline-none focus:border-[#1473e6]"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-[#505050] block mb-1">
                              Slug Identifier *
                            </label>
                            <input
                              type="text"
                              value={classFormId}
                              disabled={!isAddingClass}
                              onChange={(e) =>
                                setClassFormId(
                                  e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                                )
                              }
                              placeholder="e.g. resin, circlip"
                              className="w-full h-7 px-2 font-mono rounded-[2px] border border-[#c8c8c8] bg-white text-xs outline-none focus:border-[#1473e6] disabled:bg-[#f0f0f0] disabled:text-[#707070]"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[11px] font-semibold text-[#505050] block mb-1">
                            Display Format Template (Optional)
                          </label>
                          <input
                            type="text"
                            value={classFormFormat}
                            onChange={(e) => setClassFormFormat(e.target.value)}
                            placeholder="e.g. {width_mm}x{height_mm}mm or {thread}x{length_mm} ({head_type})"
                            className="w-full h-7 px-2 font-mono rounded-[2px] border border-[#c8c8c8] bg-white text-xs outline-none focus:border-[#1473e6]"
                          />
                          <p className="text-[10px] text-[#707070] mt-1">
                            Used to generate canonical Dimensions string. Enclose field keys in
                            braces, e.g.{" "}
                            <code className="bg-gray-100 px-1 py-0.5 rounded text-[10px]">
                              {"{width_mm}x{height_mm}mm"}
                            </code>
                            . Leave blank to use standard order.
                          </p>
                        </div>

                        {/* MEASUREMENT RULES (DINO / VISION EXPORT) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div>
                            <label className="text-[11px] font-semibold text-[#505050] block mb-1">
                              Length Rule (e.g. length_mm, height_mm, length_mm - head_length_mm)
                            </label>
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={classFormLengthRule}
                                onChange={(e) => setClassFormLengthRule(e.target.value)}
                                placeholder="e.g. length_mm"
                                className="flex-1 h-7 px-2 font-mono rounded-[2px] border border-[#c8c8c8] bg-white text-xs outline-none focus:border-[#1473e6]"
                              />
                              <select
                                value=""
                                onChange={(e) => {
                                  if (e.target.value) setClassFormLengthRule(e.target.value);
                                }}
                                className="h-7 px-1.5 text-[11px] rounded-[2px] border border-[#c8c8c8] bg-white text-[#505050]"
                              >
                                <option value="">Presets...</option>
                                <option value="length_mm">length_mm</option>
                                <option value="height_mm">height_mm</option>
                                <option value="thickness_mm">thickness_mm</option>
                                <option value="length_mm - head_length_mm">
                                  length_mm - head_length_mm
                                </option>
                              </select>
                            </div>
                            <p className="text-[10px] text-[#707070] mt-1">
                              Expression or field that yields part length for Vision / DINO exports.
                            </p>
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-[#505050] block mb-1">
                              Diameter / Cross-Section Rule (e.g. thread, af_mm, width_mm, od_mm)
                            </label>
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={classFormDiameterRule}
                                onChange={(e) => setClassFormDiameterRule(e.target.value)}
                                placeholder="e.g. thread"
                                className="flex-1 h-7 px-2 font-mono rounded-[2px] border border-[#c8c8c8] bg-white text-xs outline-none focus:border-[#1473e6]"
                              />
                              <select
                                value=""
                                onChange={(e) => {
                                  if (e.target.value) setClassFormDiameterRule(e.target.value);
                                }}
                                className="h-7 px-1.5 text-[11px] rounded-[2px] border border-[#c8c8c8] bg-white text-[#505050]"
                              >
                                <option value="">Presets...</option>
                                <option value="thread">thread</option>
                                <option value="af_mm">af_mm</option>
                                <option value="od_mm">od_mm</option>
                                <option value="width_mm">width_mm</option>
                              </select>
                            </div>
                            <p className="text-[10px] text-[#707070] mt-1">
                              Cross-sectional dimension or nominal thread for Vision / DINO exports.
                            </p>
                          </div>
                        </div>

                        <div>
                          <label className="text-[11px] font-semibold text-[#505050] block mb-1">
                            Measurement Rule Note (Optional)
                          </label>
                          <input
                            type="text"
                            value={classFormRuleNote}
                            onChange={(e) => setClassFormRuleNote(e.target.value)}
                            placeholder="e.g. Shank length and nominal thread diameter"
                            className="w-full h-7 px-2 rounded-[2px] border border-[#c8c8c8] bg-white text-xs outline-none focus:border-[#1473e6]"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] font-semibold text-[#505050] block mb-1.5">
                            Applicable Metrology Fields &amp; Requirements
                          </label>
                          <div className="border border-[#c8c8c8] rounded-[2px] bg-white overflow-hidden">
                            <table className="w-full border-collapse text-left text-xs">
                              <thead>
                                <tr className="border-b border-[#c8c8c8] bg-[#f5f5f5] text-[10px] font-semibold text-[#707070]">
                                  <th className="px-2 py-1.5 w-16 text-center">Enable</th>
                                  <th className="px-2 py-1.5">Field</th>
                                  <th className="px-2 py-1.5 w-24 text-center">Required *</th>
                                  <th className="px-2 py-1.5">Description / Examples</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#f0f0f0]">
                                {ALL_METROLOGY_FIELDS.map((mf) => {
                                  const isEnabled = classFormFields.includes(mf.key);
                                  const isReq = classFormRequired.includes(mf.key);
                                  return (
                                    <tr
                                      key={mf.key}
                                      className={`hover:bg-[#fafafa] ${isEnabled ? "bg-blue-50/20" : ""}`}
                                    >
                                      <td className="px-2 py-1.5 text-center">
                                        <input
                                          type="checkbox"
                                          checked={isEnabled}
                                          onChange={() => handleToggleField(mf.key)}
                                          className="size-3.5 rounded-[2px] cursor-pointer"
                                        />
                                      </td>
                                      <td className="px-2 py-1.5">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-medium text-[#282828] text-[11px]">
                                            {mf.label}
                                          </span>
                                          <span className="font-mono text-[9px] bg-gray-100 text-gray-700 px-1 rounded-[2px]">
                                            {mf.key}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="px-2 py-1.5 text-center">
                                        <input
                                          type="checkbox"
                                          checked={isReq}
                                          disabled={!isEnabled}
                                          onChange={() => handleToggleRequired(mf.key)}
                                          className="size-3.5 rounded-[2px] cursor-pointer disabled:opacity-30"
                                        />
                                      </td>
                                      <td className="px-2 py-1.5 text-[11px] text-[#707070]">
                                        {mf.description}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e5e5e5]">
                          <button
                            type="button"
                            onClick={handleCancelClassForm}
                            className="press h-6 px-3 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-[#282828] text-[11px]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={classFormSaving}
                            onClick={() => void handleSaveClass()}
                            className="press inline-flex items-center gap-1 h-6 px-3 rounded-[2px] bg-[#1473e6] text-white hover:bg-[#0d62c7] text-[11px] font-medium disabled:opacity-40"
                          >
                            {classFormSaving ? (
                              <>
                                <Loader2 className="size-3 animate-spin" />
                                <span>Saving...</span>
                              </>
                            ) : (
                              <span>{isAddingClass ? "Create Class" : "Save Changes"}</span>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* CLASSES LIST TABLE */}
                    <div className="overflow-x-auto border border-[#c8c8c8] rounded-[2px]">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-[#c8c8c8] bg-[#f5f5f5] text-[11px] font-semibold text-[#707070]">
                            <th className="px-2.5 py-1.5">Class Name</th>
                            <th className="px-2.5 py-1.5">Slug ID</th>
                            <th className="px-2.5 py-1.5">Applicable Metrology Fields</th>
                            <th className="px-2.5 py-1.5">Display Format</th>
                            <th className="px-2.5 py-1.5">Measurement Rules (DINO)</th>
                            <th className="px-2.5 py-1.5">Status</th>
                            <th className="px-2.5 py-1.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f0f0f0]">
                          {(partTypes ?? [])
                            .filter((pt) => showArchivedClasses || !pt.archived)
                            .map((pt) => (
                              <tr
                                key={pt.id}
                                className={`hover:bg-[#f9f9f9] ${pt.archived ? "opacity-60 bg-[#fbfbfb]" : ""}`}
                              >
                                <td className="px-2.5 py-2 font-bold text-[#282828] text-[11px]">
                                  {pt.name}
                                </td>
                                <td className="px-2.5 py-2 font-mono text-[11px] text-[#707070]">
                                  {pt.id}
                                </td>
                                <td className="px-2.5 py-2">
                                  <div className="flex flex-wrap gap-1 max-w-md">
                                    {(pt.fields ?? []).map((f) => {
                                      const isReq = (pt.required_fields ?? []).includes(f);
                                      return (
                                        <span
                                          key={f}
                                          className={`font-mono text-[9px] px-1 py-0.5 rounded-[2px] border ${
                                            isReq
                                              ? "bg-amber-50 text-amber-800 border-amber-200 font-semibold"
                                              : "bg-gray-100 text-gray-700 border-gray-200"
                                          }`}
                                          title={isReq ? "Required field" : "Optional field"}
                                        >
                                          {f}
                                          {isReq && " *"}
                                        </span>
                                      );
                                    })}
                                    {(!pt.fields || pt.fields.length === 0) && (
                                      <span className="text-[10px] text-[#a0a0a0] italic">
                                        No structured fields
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-2.5 py-2 font-mono text-[10px] text-[#505050]">
                                  {pt.display_format ? (
                                    <code className="bg-gray-100 px-1 py-0.5 rounded text-[10px]">
                                      {pt.display_format}
                                    </code>
                                  ) : (
                                    <span className="text-[#a0a0a0] italic font-sans text-[10px]">
                                      Default order
                                    </span>
                                  )}
                                </td>
                                <td className="px-2.5 py-2 font-mono text-[10px] text-[#505050]">
                                  {pt.length_rule || pt.diameter_rule ? (
                                    <div className="flex flex-col gap-0.5">
                                      {pt.length_rule && (
                                        <span title="Length calculation rule">
                                          <strong className="text-[#707070]">L:</strong>{" "}
                                          {pt.length_rule}
                                        </span>
                                      )}
                                      {pt.diameter_rule && (
                                        <span title="Diameter / cross-section rule">
                                          <strong className="text-[#707070]">Dia:</strong>{" "}
                                          {pt.diameter_rule}
                                        </span>
                                      )}
                                      {pt.note && (
                                        <span
                                          className="text-[9px] text-[#707070] italic font-sans truncate max-w-[140px]"
                                          title={pt.note}
                                        >
                                          {pt.note}
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-[#a0a0a0] italic font-sans text-[10px]">
                                      Unset
                                    </span>
                                  )}
                                </td>
                                <td className="px-2.5 py-2">
                                  {pt.archived ? (
                                    <span className="font-mono text-[9px] bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded-[2px]">
                                      Archived
                                    </span>
                                  ) : (
                                    <span className="font-mono text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-[2px]">
                                      Active
                                    </span>
                                  )}
                                </td>
                                <td className="px-2.5 py-2 text-right">
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditClass(pt)}
                                      className="press h-5 px-1.5 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-[#282828] text-[10px] inline-flex items-center gap-1"
                                      title="Edit class fields and format"
                                    >
                                      <Edit2 className="size-2.5" />
                                      <span>Edit</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleArchive(pt)}
                                      className={`press h-5 px-1.5 rounded-[2px] border text-[10px] inline-flex items-center gap-1 ${
                                        pt.archived
                                          ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                          : "border-amber-200 text-amber-700 hover:bg-amber-50"
                                      }`}
                                      title={
                                        pt.archived
                                          ? "Restore to entry UI"
                                          : "Archive class (hide from entry UI)"
                                      }
                                    >
                                      {pt.archived ? (
                                        <>
                                          <RotateCcw className="size-2.5" />
                                          <span>Restore</span>
                                        </>
                                      ) : (
                                        <>
                                          <Archive className="size-2.5" />
                                          <span>Archive</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          {(partTypes ?? []).filter((pt) => showArchivedClasses || !pt.archived)
                            .length === 0 && (
                            <tr>
                              <td
                                colSpan={7}
                                className="px-3 py-6 text-center text-xs text-[#707070]"
                              >
                                {project
                                  ? "No classes defined for this project yet. Click 'Add Class' or select a preset template above."
                                  : "No project selected. Open a project to view its classes."}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: DATASET EXPORT */}
              {activeTab === "export" && (
                <div className="bg-white border border-[#c8c8c8] rounded-[2px] p-3 flex flex-col gap-3">
                  <div>
                    <h2 className="text-xs font-semibold text-[#282828]">
                      Dataset Export (.tar / YOLO / COCO / DINO)
                    </h2>
                    <p className="text-[11px] text-[#707070]">
                      Stream full TAR dataset archives or labels-only packages directly from SQLite
                      / PostgreSQL.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Project Selection */}
                    <div>
                      <label className="text-[10px] uppercase font-bold text-[#707070] block mb-1">
                        Select Project
                      </label>
                      <select
                        value={projectToExport?.id ?? ""}
                        onChange={(e) => {
                          const id = Number(e.target.value);
                          setProjectToExport((projects ?? []).find((p) => p.id === id) ?? null);
                        }}
                        className="w-full h-7 rounded-[2px] border border-[#c8c8c8] bg-white text-xs px-2"
                      >
                        {(projects ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.completePhotos ?? 0} labeled)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Format Selection */}
                    <div>
                      <label className="text-[10px] uppercase font-bold text-[#707070] block mb-1">
                        Format
                      </label>
                      <select
                        value={exportFormat}
                        onChange={(e) => {
                          const fmt = e.target.value as ExportFormat;
                          setExportFormat(fmt);
                          if (fmt === "dino" || fmt === "yolo_dino" || fmt === "coco_dino") {
                            setExportType("full_tar");
                          }
                        }}
                        className="w-full h-7 rounded-[2px] border border-[#c8c8c8] bg-white text-xs px-2"
                      >
                        <option value="yolo">YOLO (.tar)</option>
                        <option value="coco">COCO JSON (.tar)</option>
                        <option value="dino">DINO Catalogue (.tar)</option>
                        <option value="yolo_dino">YOLO + DINO Combined</option>
                        <option value="coco_dino">COCO + DINO Combined</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[#f0f0f0]">
                    {/* Scope Selection */}
                    <div>
                      <label className="text-[10px] uppercase font-bold text-[#707070] block mb-1">
                        Scope
                      </label>
                      <div className="flex gap-2">
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                          <input
                            type="radio"
                            name="scope"
                            checked={exportScope === "all"}
                            onChange={() => setExportScope("all")}
                          />
                          <span>All Completed</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                          <input
                            type="radio"
                            name="scope"
                            checked={exportScope === "approved"}
                            onChange={() => setExportScope("approved")}
                          />
                          <span>Approved Only (QA Frozen)</span>
                        </label>
                      </div>
                    </div>

                    {/* Content Type */}
                    <div>
                      <label className="text-[10px] uppercase font-bold text-[#707070] block mb-1">
                        Package Content
                      </label>
                      <div className="flex gap-2">
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                          <input
                            type="radio"
                            name="type"
                            checked={exportType === "full_tar"}
                            onChange={() => setExportType("full_tar")}
                          />
                          <span>Full TAR (Images + Labels)</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                          <input
                            type="radio"
                            name="type"
                            checked={exportType === "labels_only"}
                            disabled={
                              exportFormat === "dino" ||
                              exportFormat === "yolo_dino" ||
                              exportFormat === "coco_dino"
                            }
                            onChange={() => setExportType("labels_only")}
                          />
                          <span>Labels Only (.tar)</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Train / Validation Split */}
                  {exportFormat !== "dino" && (
                    <div className="pt-1 border-t border-[#f0f0f0]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase font-bold text-[#707070]">
                          Train / Validation Split
                        </span>
                        <span className="font-mono text-[11px] font-bold text-[#1473e6]">
                          {trainSplit}% Train / {100 - trainSplit}% Val
                        </span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="100"
                        step="5"
                        value={trainSplit}
                        onChange={(e) => setTrainSplit(Number(e.target.value))}
                        className="w-full accent-[#1473e6]"
                      />
                    </div>
                  )}

                  {/* Progress & Error Readout */}
                  {isExporting && (
                    <div className="p-2 bg-[#f9f9f9] border border-[#c8c8c8] rounded-[2px] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Loader2 className="size-3.5 animate-spin text-[#1473e6]" />
                        <span className="text-xs font-mono">
                          {exportStatusText || "Streaming TAR dataset..."} (
                          {formatBytes(bytesExported)})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => exportAbortRef.current?.abort()}
                        className="press h-5 px-2 rounded-[2px] border border-red-300 text-red-600 hover:bg-red-50 text-[10px]"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {exportError && (
                    <div className="p-2 bg-red-50 border border-red-200 text-red-800 text-xs rounded-[2px]">
                      {exportError}
                    </div>
                  )}

                  {/* Action Button */}
                  <div className="pt-2 border-t border-[#f0f0f0]">
                    <button
                      type="button"
                      disabled={isExporting || !projectToExport}
                      onClick={() => void handleStartExport()}
                      className="press h-7 px-4 rounded-[2px] bg-[#1473e6] hover:bg-[#0d62c7] text-white font-medium text-xs flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <Download className="size-3.5" />
                      <span>Download Dataset Archive (.tar)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: DATABASE & MAINTENANCE */}
              {activeTab === "database" && (
                <div className="flex flex-col gap-2">
                  {/* Database Server Configuration Card */}
                  <div className="bg-white border border-[#c8c8c8] rounded-[2px] p-3 flex flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="text-xs font-semibold text-[#282828] flex items-center gap-1.5">
                          <Server className="size-3.5 text-[#1473e6]" />
                          <span>Database Server Connection</span>
                        </h2>
                        <p className="text-[11px] text-[#707070]">
                          Active PostgreSQL cluster connection parameters and relocation settings.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setShowDbEditor((v) => !v);
                          setTestDbResult(null);
                          setUpdateDbMessage(null);
                        }}
                        className="press h-6 px-2.5 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-xs font-medium text-[#282828] flex items-center gap-1"
                      >
                        <Wrench className="size-3" />
                        <span>{showDbEditor ? "Hide Configuration" : "Configure Connection"}</span>
                      </button>
                    </div>

                    {/* Quick Metadata Chips */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2 bg-[#f9f9f9] border border-[#c8c8c8] rounded-[2px] text-xs">
                      <div>
                        <span className="text-[10px] text-[#707070] block font-mono">
                          Host &amp; Port
                        </span>
                        <span className="font-semibold font-mono text-[#282828]">
                          {dbConfig ? `${dbConfig.host}:${dbConfig.port}` : "localhost:5432"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#707070] block font-mono">Database</span>
                        <span className="font-semibold font-mono text-[#282828]">
                          {dbConfig?.database || "ls_marker"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#707070] block font-mono">User</span>
                        <span className="font-semibold font-mono text-[#282828]">
                          {dbConfig?.user || "ls_marker"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#707070] block font-mono">Status</span>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                          <span className="size-1.5 rounded-full bg-emerald-600 inline-block" />
                          <span>Connected</span>
                        </span>
                      </div>
                    </div>

                    {/* Current Config Source Footnote */}
                    <div className="flex items-center justify-between text-[10px] text-[#707070] font-mono px-1">
                      <span>Source: {dbConfig?.source || ".env (DATABASE_URL)"}</span>
                      <span>Target: PostgreSQL 18</span>
                    </div>

                    {/* Collapsible Connection Editor */}
                    {showDbEditor && (
                      <div className="pt-2 border-t border-[#f0f0f0] flex flex-col gap-2">
                        <div>
                          <label className="text-[11px] font-medium text-[#282828] block mb-1">
                            PostgreSQL Connection URI (DATABASE_URL):
                          </label>
                          <input
                            type="text"
                            spellCheck={false}
                            placeholder="postgresql://ls_marker:password@remote-host:5432/ls_marker"
                            value={candidateUrl}
                            onChange={(e) => {
                              setCandidateUrl(e.target.value);
                              setTestDbResult(null);
                            }}
                            className="w-full h-7 px-2 rounded-[2px] border border-[#c8c8c8] bg-white font-mono text-xs text-[#282828] outline-none focus:border-[#1473e6]"
                          />
                          <p className="text-[10px] text-[#707070] mt-1 leading-normal">
                            To relocate the database, enter the connection string for your new
                            PostgreSQL server. Click &ldquo;Test Connection&rdquo; to verify
                            credentials and reachability before applying.
                          </p>
                        </div>

                        {testDbResult && (
                          <div
                            className={`p-2 rounded-[2px] border font-mono text-xs ${
                              testDbResult.ok
                                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                                : "bg-red-50 border-red-300 text-red-900"
                            }`}
                          >
                            {testDbResult.ok ? (
                              <div className="flex items-center justify-between">
                                <span>
                                  ✓ Connection successful ({testDbResult.database},{" "}
                                  {testDbResult.latencyMs}ms)
                                </span>
                                <span className="text-[10px] opacity-80">
                                  {testDbResult.version?.split(" ")[0]}
                                </span>
                              </div>
                            ) : (
                              <span>✗ Connection failed: {testDbResult.error}</span>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={testingDb || !candidateUrl.trim()}
                            onClick={() => void handleTestDbConnection()}
                            className="press h-6 px-3 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-xs font-medium text-[#282828] flex items-center gap-1 disabled:opacity-40"
                          >
                            {testingDb ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <RefreshCw className="size-3" />
                            )}
                            <span>Test Connection</span>
                          </button>

                          <button
                            type="button"
                            disabled={
                              updatingDb || !candidateUrl.trim() || candidateUrl.includes("••••••")
                            }
                            onClick={() => void handleApplyDbConfig()}
                            className="press h-6 px-3 rounded-[2px] bg-[#1473e6] hover:bg-[#0d62c7] text-white text-xs font-medium flex items-center gap-1 disabled:opacity-40"
                            title={
                              candidateUrl.includes("••••••")
                                ? "Enter your real password instead of bullets before saving"
                                : "Save and apply new database connection"
                            }
                          >
                            {updatingDb ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Check className="size-3" />
                            )}
                            <span>Save &amp; Apply</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {updateDbMessage && (
                      <div
                        className={`p-2 rounded-[2px] border text-xs ${
                          updateDbMessage.type === "success"
                            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                            : "bg-red-50 border-red-200 text-red-800"
                        }`}
                      >
                        {updateDbMessage.text}
                      </div>
                    )}
                  </div>

                  <div className="bg-white border border-[#c8c8c8] rounded-[2px] p-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-xs font-semibold text-[#282828]">
                        PostgreSQL Database Backup
                      </h2>
                      <p className="text-[11px] text-[#707070]">
                        Download a consistent SQL snapshot of all projects, images, boxes, classes,
                        and users.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsBackupModalOpen(true)}
                      className="press h-7 px-3 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-[#282828] text-xs font-medium flex items-center gap-1.5"
                    >
                      <Database className="size-3.5 text-[#1473e6]" />
                      <span>Backup Database</span>
                    </button>
                  </div>

                  <div className="bg-white border border-[#c8c8c8] rounded-[2px] p-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-xs font-semibold text-[#282828]">
                        System Maintenance Mode
                      </h2>
                      <p className="text-[11px] text-[#707070]">
                        Temporarily pauses active labeling and claims so schema migrations or git
                        updates run safely.
                      </p>
                      <div className="mt-1">
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.2 rounded-[2px] font-semibold ${
                            isMaintenance
                              ? "bg-amber-400 text-amber-950"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          Status: {isMaintenance ? "Active (Paused)" : "Normal (Live)"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsMaintenanceModalOpen(true)}
                      className="press h-7 px-3 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-[#282828] text-xs font-medium flex items-center gap-1.5"
                    >
                      <Wrench className="size-3.5 text-amber-600" />
                      <span>Configure Maintenance</span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 4: AI MODELS & CACHE */}
              {activeTab === "ai" && (
                <div className="flex flex-col gap-2">
                  {/* Availability / Disable Control */}
                  <div className="bg-white border border-[#c8c8c8] rounded-[2px] p-3 flex flex-col gap-2.5">
                    <div>
                      <h2 className="text-xs font-semibold text-[#282828]">
                        AI Auto-Trace Tool Availability
                      </h2>
                      <p className="text-[11px] text-[#707070]">
                        Control whether the SAM 2.1 AI Auto-Trace feature is enabled across the
                        workspace. When disabled, the tool icon is completely hidden from the Label
                        menu and annotators are blocked from running model inferences.
                      </p>
                    </div>

                    <div className="flex items-center justify-between p-2 bg-[#f9f9f9] border border-[#c8c8c8] rounded-[2px]">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-purple-600 shrink-0" />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-xs text-[#282828]">
                              SAM 2.1 Auto-Trace
                            </span>
                            <span
                              className={`font-mono text-[10px] px-1.5 py-0.2 rounded-[2px] font-bold border ${
                                aiEnabled
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                  : "bg-rose-100 text-rose-800 border-rose-300"
                              }`}
                            >
                              {aiEnabled ? "Enabled" : "Disabled"}
                            </span>
                          </div>
                          <span className="text-[10px] text-[#707070]">
                            {aiEnabled
                              ? "Icon visible in Label menu • Annotators can trace shapes"
                              : "Icon hidden from Label menu • Annotators blocked from using AI"}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={togglingAi}
                        onClick={() => void handleToggleAi()}
                        className={`press h-6 px-3 rounded-[2px] text-xs font-medium flex items-center gap-1 border disabled:opacity-40 ${
                          aiEnabled
                            ? "bg-white border-[#c8c8c8] text-rose-600 hover:bg-rose-50 hover:border-rose-300"
                            : "bg-[#1473e6] border-[#1473e6] text-white hover:bg-[#0d62c7]"
                        }`}
                      >
                        {togglingAi ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : aiEnabled ? (
                          <PowerOff className="size-3" />
                        ) : (
                          <Power className="size-3" />
                        )}
                        <span>{aiEnabled ? "Disable AI Tool" : "Enable AI Tool"}</span>
                      </button>
                    </div>

                    {aiMessage && (
                      <p
                        className={`font-mono text-[11px] p-2 border rounded-[2px] ${
                          aiEnabled
                            ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                            : "text-amber-800 bg-amber-50 border-amber-200"
                        }`}
                      >
                        {aiMessage}
                      </p>
                    )}
                  </div>

                  {/* Local AI Model Cache */}
                  <div className="bg-white border border-[#c8c8c8] rounded-[2px] p-3 flex flex-col gap-2.5">
                    <div>
                      <h2 className="text-xs font-semibold text-[#282828]">
                        Local AI Model Cache (SAM 2.1)
                      </h2>
                      <p className="text-[11px] text-[#707070]">
                        SAM 2.1 Hiera Tiny ONNX weights (~120 MB) are permanently stored in browser
                        Cache Storage (
                        <code className="font-mono text-[#282828]">{CACHE_NAME}</code>) so
                        offline/LAN annotators experience sub-50ms model boots.
                      </p>
                    </div>

                    <div className="flex items-center justify-between p-2 bg-[#f9f9f9] border border-[#c8c8c8] rounded-[2px]">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-purple-600" />
                        <span className="font-semibold text-xs text-[#282828]">
                          SAM 2.1 Hiera Tiny
                        </span>
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.2 rounded-[2px] font-bold ${
                            samCached
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : "bg-neutral-100 text-neutral-600 border border-[#c8c8c8]"
                          }`}
                        >
                          {samCached ? "Cached on Local Disk" : "Not Cached"}
                        </span>
                      </div>

                      <button
                        type="button"
                        disabled={clearingSamCache}
                        onClick={() => void handleClearSamCache()}
                        className="press h-6 px-2.5 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-red-600 text-xs font-medium flex items-center gap-1 disabled:opacity-40"
                      >
                        {clearingSamCache ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                        <span>Clear Cache</span>
                      </button>
                    </div>

                    {samCacheMessage && (
                      <p className="font-mono text-[11px] text-emerald-700 bg-emerald-50 p-2 border border-emerald-200 rounded-[2px]">
                        {samCacheMessage}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 5: USER MANAGEMENT */}
              {activeTab === "users" && (
                <div className="flex flex-col gap-2">
                  {/* Create User Form */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await createUser(username.trim(), userPassword);
                        setUsers(await fetchUsers());
                        setUsername("");
                        setUserPassword("");
                      });
                    }}
                    className="bg-white border border-[#c8c8c8] rounded-[2px] p-2.5 flex items-center gap-2"
                  >
                    <span className="font-semibold text-xs text-[#282828] shrink-0">
                      Add Labeller:
                    </span>
                    <input
                      type="text"
                      placeholder="Username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      className="h-6 w-36 px-1.5 rounded-[2px] border border-[#c8c8c8] text-xs bg-white"
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      autoComplete="new-password"
                      value={userPassword}
                      onChange={(e) => setUserPassword(e.target.value)}
                      required
                      className="h-6 w-36 px-1.5 rounded-[2px] border border-[#c8c8c8] text-xs bg-white"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="press h-6 px-3 rounded-[2px] bg-[#1473e6] text-white text-xs font-medium hover:bg-[#0d62c7]"
                    >
                      Create User
                    </button>
                  </form>

                  {/* Users Table */}
                  <div className="bg-white border border-[#c8c8c8] rounded-[2px] overflow-hidden">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#c8c8c8] bg-[#f5f5f5] text-[11px] font-semibold text-[#707070]">
                          <th className="px-3 py-1.5">Username</th>
                          <th className="px-3 py-1.5">User ID</th>
                          <th className="px-3 py-1.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f0f0f0]">
                        {(users ?? []).map((u) => (
                          <tr key={u.id} className="hover:bg-[#f9f9f9]">
                            <td className="px-3 py-1.5 font-bold font-mono text-[#282828]">
                              {u.username}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[11px] text-[#707070]">
                              #{u.id}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {editingUserId === u.id ? (
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    void run(async () => {
                                      await resetUserPassword(u.id, nextPassword);
                                      setEditingUserId(null);
                                      setNextPassword("");
                                    });
                                  }}
                                  className="inline-flex items-center gap-1.5"
                                >
                                  <input
                                    type="password"
                                    placeholder="New Password"
                                    value={nextPassword}
                                    onChange={(e) => setNextPassword(e.target.value)}
                                    required
                                    className="h-5 w-28 px-1.5 rounded-[2px] border border-[#c8c8c8] text-xs"
                                  />
                                  <button
                                    type="submit"
                                    className="press h-5 px-2 rounded-[2px] bg-[#1473e6] text-white text-[10px]"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingUserId(null)}
                                    className="press h-5 px-1.5 rounded-[2px] border border-[#c8c8c8] text-[#707070] text-[10px]"
                                  >
                                    Cancel
                                  </button>
                                </form>
                              ) : (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingUserId(u.id);
                                      setNextPassword("");
                                      setPendingDeleteUserId(null);
                                    }}
                                    className="press h-5 px-2 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-[#282828] text-[10px]"
                                  >
                                    Reset Password
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (pendingDeleteUserId !== u.id) {
                                        setPendingDeleteUserId(u.id);
                                        return;
                                      }
                                      void run(async () => {
                                        await deleteUser(u.id);
                                        setUsers(await fetchUsers());
                                        setPendingDeleteUserId(null);
                                      });
                                    }}
                                    className={`press h-5 px-2 rounded-[2px] border text-[10px] ${
                                      pendingDeleteUserId === u.id
                                        ? "bg-red-600 text-white border-red-600"
                                        : "border-[#c8c8c8] text-red-600 hover:bg-red-50"
                                    }`}
                                  >
                                    {pendingDeleteUserId === u.id ? "Confirm Delete" : "Delete"}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </main>
          </div>
        ) : null}
      </div>

      {/* Delete Project Confirmation Modal */}
      {projectToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm rounded-[2px] border border-[#c8c8c8] bg-white p-4 shadow-none text-xs">
            <div className="flex items-center gap-2 text-red-600">
              <Trash2 className="size-5 shrink-0" />
              <h3 className="text-sm font-semibold text-[#282828]">Delete Project?</h3>
            </div>
            <p className="mt-2 text-[#707070] leading-relaxed">
              Permanently delete project{" "}
              <strong className="text-[#282828]">{projectToDelete.name}</strong> and all associated
              annotations from the database?
            </p>
            <div className="mt-3">
              <label className="text-[10px] uppercase font-bold text-[#707070] block mb-1">
                Admin Password Required
              </label>
              <input
                type="password"
                placeholder="Enter admin password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full h-7 px-2 rounded-[2px] border border-[#c8c8c8] bg-white text-xs"
              />
            </div>
            {deleteError && (
              <p className="mt-2 text-red-700 bg-red-50 p-1.5 border border-red-200 rounded-[2px]">
                {deleteError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setProjectToDelete(null)}
                className="press h-7 px-3 rounded-[2px] border border-[#c8c8c8] bg-white text-xs text-[#282828]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting || !adminPassword}
                onClick={() => void handleDeleteProject()}
                className="press h-7 px-3 rounded-[2px] bg-red-600 text-xs font-semibold text-white flex items-center gap-1"
              >
                {deleting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
                <span>Delete Project</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auxiliary Modals */}
      <BackupModal isOpen={isBackupModalOpen} onClose={() => setIsBackupModalOpen(false)} />
      <MaintenanceModal
        isOpen={isMaintenanceModalOpen}
        isMaintenance={isMaintenance}
        onClose={() => setIsMaintenanceModalOpen(false)}
        onToggle={handleToggleMaintenance}
      />
      {syncResult && (
        <RescanModal
          result={syncResult}
          onClose={() => setSyncResult(null)}
          onOpenDuplicates={() => {
            if (syncResult.duplicates) setDuplicatesResult(syncResult.duplicates);
          }}
        />
      )}
      {healthResult && (
        <DatasetHealthModal
          health={healthResult}
          onClose={() => setHealthResult(null)}
          onOpenDuplicates={() => {
            if (healthResult.duplicates) {
              setDuplicatesResult(healthResult.duplicates);
            }
          }}
        />
      )}
      {duplicatesResult && (
        <DuplicateCleanupModal
          isOpen={true}
          projectId={healthResult?.projectId}
          projectName={healthResult?.projectName}
          duplicates={duplicatesResult}
          onClose={() => setDuplicatesResult(null)}
          onCleanupComplete={async () => {
            setDuplicatesResult(null);
            try {
              const updatedHealth = await fetchProjectHealth();
              setHealthResult(updatedHealth);
            } catch {
              /* ignore */
            }
          }}
        />
      )}
    </div>
  );
}

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchCurrentProject, type Project } from "@/lib/label-client";

type ProjectValue = {
  current: Project | null;
  ready: boolean;
  picker: boolean;
  openPicker: () => void;
  closePicker: () => void;
};

const ProjectContext = createContext<ProjectValue | null>(null);

export function ProjectProvider({
  username,
  children,
}: {
  username: string | null;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState<Project | null | undefined>(undefined);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    if (!username) {
      setCurrent(null);
      return;
    }
    let cancel = false;
    fetchCurrentProject()
      .then((project) => {
        if (!cancel) setCurrent(project);
      })
      .catch(() => {
        if (!cancel) setCurrent(null);
      });
    return () => {
      cancel = true;
    };
  }, [username]);

  useEffect(() => {
    const open = () => setPicker(true);
    window.addEventListener("partlab-projects", open);
    return () => window.removeEventListener("partlab-projects", open);
  }, []);

  const value = useMemo<ProjectValue>(
    () => ({
      current: current ?? null,
      ready: username ? current !== undefined : true,
      picker,
      openPicker: () => setPicker(true),
      closePicker: () => setPicker(false),
    }),
    [current, picker, username],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProject outside ProjectProvider");
  return value;
}

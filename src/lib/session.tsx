import { createContext, useContext } from "react";

export type SessionValue = {
  username: string | null;
  admin: boolean;
  setUsername: (username: string | null) => void;
  setAdmin?: (admin: boolean) => void;
};

export const SessionContext = createContext<SessionValue>({
  username: null,
  admin: false,
  setUsername: () => {},
  setAdmin: () => {},
});

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

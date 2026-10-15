import { createContext, useContext } from "react";

export type SessionValue = {
  username: string | null;
  setUsername: (username: string | null) => void;
};

export const SessionContext = createContext<SessionValue>({
  username: null,
  setUsername: () => {},
});

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

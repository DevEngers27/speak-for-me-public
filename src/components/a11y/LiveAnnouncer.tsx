"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export interface LiveAnnouncerContextValue {
  readonly politeMessage: string;
  readonly alertMessage: string;
  announcePolite: (message: string) => void;
  announceAlert: (message: string) => void;
}

const LiveAnnouncerContext = createContext<LiveAnnouncerContextValue>({
  politeMessage: "",
  alertMessage: "",
  announcePolite: () => {},
  announceAlert: () => {},
});

export function useLiveAnnouncer(): LiveAnnouncerContextValue {
  return useContext(LiveAnnouncerContext);
}

/**
 * Global screen-reader live regions (13 §13.13).
 * Announces high-level room milestones (proposal ready, constraints bumped,
 * execution completed, human request opened) and action errors.
 * Never announces individual agent turns.
 */
export function LiveAnnouncerProvider({ children }: { children: ReactNode }) {
  const [politeMessage, setPoliteMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState("");

  const announcePolite = useCallback((message: string) => {
    setPoliteMessage(message);
  }, []);

  const announceAlert = useCallback((message: string) => {
    setAlertMessage(message);
  }, []);

  return (
    <LiveAnnouncerContext.Provider
      value={{ politeMessage, alertMessage, announcePolite, announceAlert }}
    >
      {children}
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="live-announcer-polite"
      >
        {politeMessage}
      </div>
      <div
        className="sr-only"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        data-testid="live-announcer-alert"
      >
        {alertMessage}
      </div>
    </LiveAnnouncerContext.Provider>
  );
}

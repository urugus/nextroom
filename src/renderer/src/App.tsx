import type { ApiResult } from "@shared/ipc";
import type { AccountStatus, AppUpdateStatus, MeetEventsSnapshot } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dashboard } from "./screens/Dashboard";
import "./styles.css";

const disconnectedStatus: AccountStatus = { connected: false, syncing: false };

export const App = () => {
  const [accountStatus, setAccountStatus] = useState<AccountStatus>(disconnectedStatus);
  const [meetingsSnapshot, setMeetingsSnapshot] = useState<MeetEventsSnapshot>({ meetings: [] });
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [openingMeetUrl, setOpeningMeetUrl] = useState<string | undefined>(undefined);
  const [pendingAction, setPendingAction] = useState<"connect" | "disconnect" | "sync" | undefined>(
    undefined,
  );
  const [updateErrorMessage, setUpdateErrorMessage] = useState<string | undefined>(undefined);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | undefined>(undefined);
  const openingMeetingRef = useRef(false);

  const applyResultError = useCallback(<T,>(result: ApiResult<T>): T | undefined => {
    if (result.ok) return result.value;
    setErrorMessage(result.error.message);
    return undefined;
  }, []);

  const applyAccountStatus = useCallback((status: AccountStatus) => {
    setAccountStatus(status);
    if (status.error !== undefined) setErrorMessage(status.error.message);
  }, []);

  const refreshStatus = useCallback(async () => {
    const status = applyResultError(await window.meetLauncher.getAccountStatus());
    if (status !== undefined) {
      applyAccountStatus(status);
    }
  }, [applyAccountStatus, applyResultError]);

  const refreshMeetings = useCallback(async () => {
    const snapshot = applyResultError(await window.meetLauncher.listUpcomingMeetings());
    if (snapshot !== undefined) setMeetingsSnapshot(snapshot);
  }, [applyResultError]);

  useEffect(() => {
    let mounted = true;

    const loadUpdateStatus = async () => {
      try {
        const result = await window.meetLauncher.getUpdateStatus();
        if (!mounted) return;

        if (result.ok) {
          setUpdateStatus(result.value);
        } else {
          setUpdateErrorMessage(result.error.message);
        }
      } catch (cause) {
        if (!mounted) return;
        const message = cause instanceof Error ? cause.message : "Update status is unavailable.";
        setUpdateErrorMessage(message);
      }
    };

    void loadUpdateStatus();

    const unsubscribe = window.meetLauncher.onUpdateStatusChanged((status) => {
      setUpdateStatus(status);
      if (status.status !== "error") {
        setUpdateErrorMessage(undefined);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshStatus();
      await refreshMeetings();
    })();

    return window.meetLauncher.onCalendarUpdated((result) => {
      const snapshot = applyResultError(result);
      if (snapshot !== undefined) {
        setMeetingsSnapshot(snapshot);
        void refreshStatus();
      }
    });
  }, [applyResultError, refreshMeetings, refreshStatus]);

  const connectAccount = async () => {
    setPendingAction("connect");
    setErrorMessage(undefined);
    try {
      const status = applyResultError(await window.meetLauncher.connectGoogleAccount());
      if (status !== undefined) applyAccountStatus(status);
      await refreshMeetings();
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Google authorization failed.");
    } finally {
      setPendingAction(undefined);
    }
  };

  const disconnectAccount = async () => {
    setPendingAction("disconnect");
    setErrorMessage(undefined);
    try {
      const status = applyResultError(await window.meetLauncher.disconnectGoogleAccount());
      if (status !== undefined) setAccountStatus(status);
      setMeetingsSnapshot({ meetings: [] });
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Google disconnect failed.");
    } finally {
      setPendingAction(undefined);
    }
  };

  const syncCalendar = async () => {
    setPendingAction("sync");
    setErrorMessage(undefined);
    setAccountStatus((current) => ({ ...current, syncing: true }));
    try {
      const snapshot = applyResultError(await window.meetLauncher.syncCalendarNow());
      if (snapshot !== undefined) setMeetingsSnapshot(snapshot);
      await refreshStatus();
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Google Calendar sync failed.");
    } finally {
      setPendingAction(undefined);
      setAccountStatus((current) => ({ ...current, syncing: false }));
    }
  };

  const openMeeting = async (meetUrl: string) => {
    if (openingMeetingRef.current) return;

    openingMeetingRef.current = true;
    setErrorMessage(undefined);
    setOpeningMeetUrl(meetUrl);

    try {
      const result = await window.meetLauncher.openMeetUrl(meetUrl);
      if (!result.ok) {
        setErrorMessage(result.error.message);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Google Meet window failed.";
      setErrorMessage(message);
    } finally {
      openingMeetingRef.current = false;
      setOpeningMeetUrl(undefined);
    }
  };

  const runUpdateAction = async (
    action: () => Promise<
      { ok: true; value: AppUpdateStatus } | { ok: false; error: { message: string } }
    >,
  ) => {
    setUpdateErrorMessage(undefined);

    try {
      const result = await action();
      if (result.ok) {
        setUpdateStatus(result.value);
      } else {
        setUpdateErrorMessage(result.error.message);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "App update failed.";
      setUpdateErrorMessage(message);
    }
  };

  const checkForUpdates = () => runUpdateAction(window.meetLauncher.checkForUpdates);
  const downloadUpdate = () => runUpdateAction(window.meetLauncher.downloadUpdate);

  const installUpdate = async () => {
    setUpdateErrorMessage(undefined);

    try {
      const result = await window.meetLauncher.installUpdate();
      if (!result.ok) {
        setUpdateErrorMessage(result.error.message);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "App update failed.";
      setUpdateErrorMessage(message);
    }
  };

  return (
    <Dashboard
      accountStatus={accountStatus}
      errorMessage={errorMessage}
      meetings={meetingsSnapshot.meetings}
      pendingAction={pendingAction}
      syncedAt={meetingsSnapshot.syncedAt}
      openingMeetUrl={openingMeetUrl}
      onCheckForUpdates={checkForUpdates}
      onConnectAccount={connectAccount}
      onDisconnectAccount={disconnectAccount}
      onDownloadUpdate={downloadUpdate}
      onInstallUpdate={installUpdate}
      onOpenMeeting={openMeeting}
      onSyncCalendar={syncCalendar}
      updateErrorMessage={updateErrorMessage}
      updateStatus={updateStatus}
    />
  );
};

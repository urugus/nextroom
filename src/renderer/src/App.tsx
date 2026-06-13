import { unknownToMessage } from "@shared/errors";
import type { ApiResult, SettingsUpdate } from "@shared/ipc";
import type {
  AccountStatus,
  AppSettings,
  AppUpdateStatus,
  MeetEvent,
  MeetEventsSnapshot,
  MenuShortcutStatus,
} from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dashboard } from "./screens/Dashboard";
import "./styles.css";

const disconnectedStatus: AccountStatus = { connected: false, syncing: false };
const meetingNotificationTickMs = 30_000;
const defaultSettings: AppSettings = {
  autoJoinEnabled: false,
  autoOpenEnabled: true,
  cameraBubbleChatMirrorEnabled: false,
  cameraBubbleEnabled: false,
  cameraBubbleSidebarHidden: false,
  cameraBubbleDisplaySpeedLevel: 3,
  joinOffsetSeconds: 0,
  notifyBeforeMinutes: 1,
  openOffsetSeconds: 0,
  menuShortcutAccelerator: "Command+Alt+N",
  launchAtLogin: false,
  calendarId: "primary",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
};

const caughtErrorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? unknownToMessage(cause) : fallback;

const isActiveMeeting = (meeting: MeetEvent, now: Date): boolean => {
  const startAt = new Date(meeting.startAt).getTime();
  const endAt = new Date(meeting.endAt).getTime();
  const nowTime = now.getTime();

  return (
    Number.isFinite(startAt) && Number.isFinite(endAt) && startAt <= nowTime && nowTime <= endAt
  );
};

export const App = () => {
  const [accountStatus, setAccountStatus] = useState<AccountStatus>(disconnectedStatus);
  const [meetingsSnapshot, setMeetingsSnapshot] = useState<MeetEventsSnapshot>({ meetings: [] });
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [menuShortcutStatus, setMenuShortcutStatus] = useState<MenuShortcutStatus | undefined>(
    undefined,
  );
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [openingMeetUrl, setOpeningMeetUrl] = useState<string | undefined>(undefined);
  const [openedMeetingKeys, setOpenedMeetingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<"connect" | "disconnect" | "sync" | undefined>(
    undefined,
  );
  const [updateErrorMessage, setUpdateErrorMessage] = useState<string | undefined>(undefined);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | undefined>(undefined);
  const openingMeetingRef = useRef(false);
  const latestSettingsRef = useRef(defaultSettings);
  const latestSettingsSaveRef = useRef(0);

  const applyResultError = useCallback(<T,>(result: ApiResult<T>): T | undefined => {
    if (result.ok) return result.value;
    setErrorMessage(result.error.message);
    return undefined;
  }, []);

  const applyAccountStatus = useCallback((status: AccountStatus) => {
    setAccountStatus(status);
    setErrorMessage(status.error?.message);
  }, []);

  const applySettings = useCallback((nextSettings: AppSettings) => {
    latestSettingsRef.current = nextSettings;
    setSettings(nextSettings);
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

  const refreshSettings = useCallback(async () => {
    const currentSettings = applyResultError(await window.meetLauncher.getSettings());
    if (currentSettings !== undefined) applySettings(currentSettings);
  }, [applyResultError, applySettings]);

  const refreshMenuShortcutStatus = useCallback(async () => {
    const currentStatus = applyResultError(await window.meetLauncher.getMenuShortcutStatus());
    if (currentStatus !== undefined) setMenuShortcutStatus(currentStatus);
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
        setUpdateErrorMessage(caughtErrorMessage(cause, "Update status is unavailable."));
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
    const timer = window.setInterval(() => {
      setCurrentTime(new Date());
    }, meetingNotificationTickMs);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshStatus();
      await refreshMeetings();
      await refreshSettings();
      await refreshMenuShortcutStatus();
    })();

    return window.meetLauncher.onCalendarUpdated((result) => {
      const snapshot = applyResultError(result);
      if (snapshot !== undefined) {
        setMeetingsSnapshot(snapshot);
        void refreshStatus();
      }
    });
  }, [
    applyResultError,
    refreshMeetings,
    refreshMenuShortcutStatus,
    refreshSettings,
    refreshStatus,
  ]);

  useEffect(() => {
    const meetingKeys = new Set(meetingsSnapshot.meetings.map((meeting) => meeting.occurrenceKey));

    setOpenedMeetingKeys((current) => {
      if (current.size === 0) return current;

      const pruned = new Set([...current].filter((key) => meetingKeys.has(key)));
      return pruned.size === current.size ? current : pruned;
    });
  }, [meetingsSnapshot.meetings]);

  const connectAccount = async () => {
    setPendingAction("connect");
    setErrorMessage(undefined);
    try {
      const status = applyResultError(await window.meetLauncher.connectGoogleAccount());
      if (status !== undefined) applyAccountStatus(status);
      await refreshMeetings();
    } catch (cause) {
      setErrorMessage(caughtErrorMessage(cause, "Google authorization failed."));
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
      setOpenedMeetingKeys(new Set());
    } catch (cause) {
      setErrorMessage(caughtErrorMessage(cause, "Google disconnect failed."));
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
      setErrorMessage(caughtErrorMessage(cause, "Google Calendar sync failed."));
    } finally {
      setPendingAction(undefined);
      setAccountStatus((current) => ({ ...current, syncing: false }));
    }
  };

  const updateSettings = async (nextSettings: SettingsUpdate) => {
    const saveId = latestSettingsSaveRef.current + 1;
    latestSettingsSaveRef.current = saveId;
    const optimisticSettings = { ...latestSettingsRef.current, ...nextSettings };
    latestSettingsRef.current = optimisticSettings;
    setSettings(optimisticSettings);

    try {
      const updated = await window.meetLauncher.updateSettings(nextSettings);
      if (latestSettingsSaveRef.current !== saveId) return;

      if (!updated.ok) {
        setErrorMessage(updated.error.message);
        await refreshSettings();
        return;
      }

      applySettings(updated.value);
    } catch (cause) {
      if (latestSettingsSaveRef.current === saveId) {
        setErrorMessage(caughtErrorMessage(cause, "Settings update failed."));
        await refreshSettings();
      }
    }
  };

  const updateOpenOffsetMinutes = async (minutes: number) => {
    const nextOpenOffsetSeconds = minutes * 60;
    const nextJoinOffsetSeconds = Math.min(
      latestSettingsRef.current.joinOffsetSeconds,
      nextOpenOffsetSeconds,
    );

    await updateSettings({
      joinOffsetSeconds: nextJoinOffsetSeconds,
      openOffsetSeconds: nextOpenOffsetSeconds,
    });
  };

  const updateAutoJoinEnabled = (autoJoinEnabled: boolean) => updateSettings({ autoJoinEnabled });

  const updateCameraBubbleEnabled = (cameraBubbleEnabled: boolean) =>
    updateSettings({ cameraBubbleEnabled });

  const updateCameraBubbleChatMirrorEnabled = (cameraBubbleChatMirrorEnabled: boolean) =>
    updateSettings({ cameraBubbleChatMirrorEnabled });

  const updateCameraBubbleDisplaySpeedLevel = (cameraBubbleDisplaySpeedLevel: number) =>
    updateSettings({ cameraBubbleDisplaySpeedLevel });

  const updateJoinOffsetMinutes = (minutes: number) =>
    updateSettings({ joinOffsetSeconds: minutes * 60 });

  const updateMenuShortcutAccelerator = async (menuShortcutAccelerator: string | null) => {
    await updateSettings({ menuShortcutAccelerator });
    await refreshMenuShortcutStatus();
  };

  const openMeeting = async (meeting: MeetEvent) => {
    if (openingMeetingRef.current) return;

    openingMeetingRef.current = true;
    setErrorMessage(undefined);
    setOpeningMeetUrl(meeting.meetUrl);

    try {
      const result = await window.meetLauncher.openMeetUrl(meeting.meetUrl);
      if (!result.ok) {
        setErrorMessage(result.error.message);
      } else {
        setOpenedMeetingKeys((current) => new Set(current).add(meeting.occurrenceKey));
      }
    } catch (cause) {
      setErrorMessage(caughtErrorMessage(cause, "Google Meet window failed."));
    } finally {
      openingMeetingRef.current = false;
      setOpeningMeetUrl(undefined);
    }
  };

  const runUpdateAction = async (action: () => Promise<ApiResult<AppUpdateStatus>>) => {
    setUpdateErrorMessage(undefined);

    try {
      const result = await action();
      if (result.ok) {
        setUpdateStatus(result.value);
      } else {
        setUpdateErrorMessage(result.error.message);
      }
    } catch (cause) {
      setUpdateErrorMessage(caughtErrorMessage(cause, "App update failed."));
    }
  };

  const checkForUpdates = () => runUpdateAction(window.meetLauncher.checkForUpdates);
  const runHomebrewUpdate = () => runUpdateAction(window.meetLauncher.runHomebrewUpdate);
  const nextMeetingNotification = meetingsSnapshot.meetings.find(
    (meeting) =>
      !openedMeetingKeys.has(meeting.occurrenceKey) && isActiveMeeting(meeting, currentTime),
  );

  return (
    <Dashboard
      accountStatus={accountStatus}
      errorMessage={errorMessage}
      pendingAction={pendingAction}
      settings={settings}
      menuShortcutStatus={menuShortcutStatus}
      syncedAt={meetingsSnapshot.syncedAt}
      openingMeetUrl={openingMeetUrl}
      nextMeetingNotification={nextMeetingNotification}
      onCheckForUpdates={checkForUpdates}
      onConnectAccount={connectAccount}
      onDisconnectAccount={disconnectAccount}
      onRunHomebrewUpdate={runHomebrewUpdate}
      onAutoJoinEnabledChange={updateAutoJoinEnabled}
      onCameraBubbleChatMirrorEnabledChange={updateCameraBubbleChatMirrorEnabled}
      onCameraBubbleEnabledChange={updateCameraBubbleEnabled}
      onCameraBubbleDisplaySpeedLevelChange={updateCameraBubbleDisplaySpeedLevel}
      onJoinOffsetMinutesChange={updateJoinOffsetMinutes}
      onMenuShortcutAcceleratorChange={updateMenuShortcutAccelerator}
      onOpenMeeting={openMeeting}
      onOpenOffsetMinutesChange={updateOpenOffsetMinutes}
      onSyncCalendar={syncCalendar}
      updateErrorMessage={updateErrorMessage}
      updateStatus={updateStatus}
    />
  );
};

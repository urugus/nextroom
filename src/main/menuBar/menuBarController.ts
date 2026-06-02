import type { AppError } from "@shared/errors";
import type { AppUpdateStatus, MeetEvent, MeetEventsSnapshot } from "@shared/types";
import type { Menu, MenuItemConstructorOptions, NativeImage, Tray } from "electron";
import type { Result } from "neverthrow";

export type MenuBarController = {
  openMenu: () => void;
  updateMeetings: (snapshot: MeetEventsSnapshot) => void;
  updateUpdateStatus: (status: AppUpdateStatus) => void;
};

type MenuBarControllerInput = {
  buildMenuFromTemplate: (template: MenuItemConstructorOptions[]) => Menu;
  createTray: (icon: NativeImage | string) => Tray;
  icon: NativeImage | string;
  openMeetUrl: (meetUrl: string) => Promise<Result<void, AppError>>;
  quitApp: () => void;
  reportError: (message: string, cause: unknown) => void;
  runUpdate: () => Promise<Result<AppUpdateStatus, AppError>>;
  showSettingsWindow: () => void;
  syncNow: () => Promise<Result<MeetEventsSnapshot, AppError>>;
};

const formatMeetingTime = (value: string): string =>
  new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(new Date(value));

const meetingLabel = (meeting: MeetEvent): string =>
  `${formatMeetingTime(meeting.startAt)} ${meeting.summary}`;

export const buildMenuBarTemplate = ({
  meetings,
  openMeetUrl,
  quitApp,
  runUpdate,
  showSettingsWindow,
  syncNow,
  updateStatus,
}: {
  meetings: MeetEvent[];
  openMeetUrl: (meetUrl: string) => void;
  quitApp: () => void;
  runUpdate: () => void;
  showSettingsWindow: () => void;
  syncNow: () => void;
  updateStatus?: AppUpdateStatus;
}): MenuItemConstructorOptions[] => [
  {
    enabled: false,
    label: "NextRoom",
  },
  {
    type: "separator",
  },
  {
    enabled: false,
    label: "Upcoming Meet meetings",
  },
  ...(meetings.length === 0
    ? [
        {
          enabled: false,
          label: "No upcoming Google Meet meetings",
        } satisfies MenuItemConstructorOptions,
      ]
    : meetings.map(
        (meeting): MenuItemConstructorOptions => ({
          click: () => {
            openMeetUrl(meeting.meetUrl);
          },
          label: meetingLabel(meeting),
        }),
      )),
  {
    type: "separator",
  },
  {
    click: syncNow,
    label: "Sync Now",
  },
  ...(updateStatus?.status === "available"
    ? [
        {
          click: runUpdate,
          label: "Update",
        } satisfies MenuItemConstructorOptions,
      ]
    : []),
  ...(updateStatus?.status === "homebrew-updating"
    ? [
        {
          enabled: false,
          label: "Updating",
        } satisfies MenuItemConstructorOptions,
      ]
    : []),
  {
    click: showSettingsWindow,
    label: "Settings...",
  },
  {
    type: "separator",
  },
  {
    click: quitApp,
    label: "Quit",
  },
];

export const createMenuBarController = ({
  buildMenuFromTemplate,
  createTray,
  icon,
  openMeetUrl,
  quitApp,
  reportError,
  runUpdate,
  showSettingsWindow,
  syncNow,
}: MenuBarControllerInput): MenuBarController => {
  const tray = createTray(icon);
  let meetings: MeetEvent[] = [];
  let updateStatus: AppUpdateStatus | undefined;
  let currentMenu: Menu | undefined;

  const rebuildMenu = (): void => {
    const menu = buildMenuFromTemplate(
      buildMenuBarTemplate({
        meetings,
        openMeetUrl: (meetUrl) => {
          void openMeetUrl(meetUrl)
            .then((result) => {
              if (result.isErr()) {
                reportError("Failed to open Meet from the menu bar.", result.error);
              }
            })
            .catch((cause: unknown) => {
              reportError("Failed to open Meet from the menu bar.", cause);
            });
        },
        quitApp,
        runUpdate: () => {
          void runUpdate()
            .then((result) => {
              if (result.isErr()) {
                reportError("Failed to update from the menu bar.", result.error);
              }
            })
            .catch((cause: unknown) => {
              reportError("Failed to update from the menu bar.", cause);
            });
        },
        showSettingsWindow,
        syncNow: () => {
          void syncNow()
            .then((result) => {
              if (result.isErr()) {
                reportError("Failed to sync Calendar from the menu bar.", result.error);
              }
            })
            .catch((cause: unknown) => {
              reportError("Failed to sync Calendar from the menu bar.", cause);
            });
        },
        updateStatus,
      }),
    );

    currentMenu = menu;
    tray.setToolTip("NextRoom");
    tray.setContextMenu(menu);
  };

  rebuildMenu();

  return {
    openMenu: () => {
      if (currentMenu !== undefined) {
        tray.popUpContextMenu(currentMenu);
      }
    },
    updateMeetings: (snapshot) => {
      meetings = snapshot.meetings;
      rebuildMenu();
    },
    updateUpdateStatus: (status) => {
      updateStatus = status;
      rebuildMenu();
    },
  };
};

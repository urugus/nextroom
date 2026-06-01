import { buildMenuBarTemplate, createMenuBarController } from "@main/menuBar/menuBarController";
import type { AppError } from "@shared/errors";
import type { MeetEvent } from "@shared/types";
import type { Menu, MenuItemConstructorOptions, NativeImage, Tray } from "electron";
import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const meeting: MeetEvent = {
  calendarId: "primary",
  endAt: "2026-05-28T10:30:00",
  eventId: "event-1",
  meetUrl: "https://meet.google.com/abc-defg-hij",
  occurrenceKey: "primary:event-1:2026-05-28T10:00:00",
  startAt: "2026-05-28T10:00:00",
  status: "confirmed",
  summary: "Product sync",
  updatedAt: "2026-05-28T09:00:00",
};

const clickItem = (item: MenuItemConstructorOptions): void => {
  item.click?.(undefined as never, undefined as never, undefined as never);
};

describe("buildMenuBarTemplate", () => {
  it("builds meeting items with time labels and opens the selected Meet URL", () => {
    const openMeetUrl = vi.fn();
    const template = buildMenuBarTemplate({
      meetings: [meeting],
      openMeetUrl,
      quitApp: vi.fn(),
      showSettingsWindow: vi.fn(),
      syncNow: vi.fn(),
    });

    const meetingItem = template.find((item) => item.label === "10:00 Product sync");
    expect(meetingItem).toBeDefined();

    clickItem(meetingItem as MenuItemConstructorOptions);

    expect(openMeetUrl).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
  });

  it("builds a disabled empty item when there are no upcoming meetings", () => {
    const template = buildMenuBarTemplate({
      meetings: [],
      openMeetUrl: vi.fn(),
      quitApp: vi.fn(),
      showSettingsWindow: vi.fn(),
      syncNow: vi.fn(),
    });

    expect(template).toContainEqual(
      expect.objectContaining({
        enabled: false,
        label: "No upcoming Google Meet meetings",
      }),
    );
  });

  it("wires Sync Now and Settings actions", () => {
    const showSettingsWindow = vi.fn();
    const syncNow = vi.fn();
    const template = buildMenuBarTemplate({
      meetings: [],
      openMeetUrl: vi.fn(),
      quitApp: vi.fn(),
      showSettingsWindow,
      syncNow,
    });

    clickItem(template.find((item) => item.label === "Sync Now") as MenuItemConstructorOptions);
    clickItem(template.find((item) => item.label === "Settings...") as MenuItemConstructorOptions);

    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(showSettingsWindow).toHaveBeenCalledTimes(1);
  });
});

describe("createMenuBarController", () => {
  it("rebuilds the tray menu when meetings are updated", () => {
    const setContextMenu = vi.fn();
    const tray = {
      popUpContextMenu: vi.fn(),
      setContextMenu,
      setToolTip: vi.fn(),
    } as unknown as Tray;
    const menus: MenuItemConstructorOptions[][] = [];

    const controller = createMenuBarController({
      buildMenuFromTemplate: (template) => {
        menus.push(template);
        return template as unknown as Menu;
      },
      createTray: vi.fn(() => tray),
      icon: "icon" as unknown as NativeImage,
      openMeetUrl: vi.fn(() => Promise.resolve(ok(undefined))),
      quitApp: vi.fn(),
      reportError: vi.fn(),
      showSettingsWindow: vi.fn(),
      syncNow: vi.fn(() => Promise.resolve(ok({ meetings: [] }))),
    });

    controller.updateMeetings({ meetings: [meeting], syncedAt: "2026-05-28T09:50:00" });

    expect(setContextMenu).toHaveBeenCalledTimes(2);
    expect(menus.at(-1)).toContainEqual(
      expect.objectContaining({
        label: "10:00 Product sync",
      }),
    );
  });

  it("opens the current tray menu", () => {
    const popUpContextMenu = vi.fn();
    const initialMenu = { label: "initial" } as unknown as Menu;
    const updatedMenu = { label: "updated" } as unknown as Menu;
    const builtMenus = [initialMenu, updatedMenu];
    const tray = {
      popUpContextMenu,
      setContextMenu: vi.fn(),
      setToolTip: vi.fn(),
    } as unknown as Tray;
    const controller = createMenuBarController({
      buildMenuFromTemplate: vi.fn(() => builtMenus.shift() ?? updatedMenu),
      createTray: vi.fn(() => tray),
      icon: "icon" as unknown as NativeImage,
      openMeetUrl: vi.fn(() => Promise.resolve(ok(undefined))),
      quitApp: vi.fn(),
      reportError: vi.fn(),
      showSettingsWindow: vi.fn(),
      syncNow: vi.fn(() => Promise.resolve(ok({ meetings: [] }))),
    });

    controller.updateMeetings({ meetings: [meeting] });
    controller.openMenu();

    expect(popUpContextMenu).toHaveBeenCalledWith(updatedMenu);
  });

  it("reports meeting open and sync failures from tray actions", async () => {
    const reportError = vi.fn();
    const menus: MenuItemConstructorOptions[][] = [];
    const meetWindowError: AppError = { type: "MeetWindowFailed", cause: "window failed" };
    const syncError: AppError = { type: "CalendarApiFailed", cause: "sync failed" };
    const controller = createMenuBarController({
      buildMenuFromTemplate: (template) => {
        menus.push(template);
        return template as unknown as Menu;
      },
      createTray: vi.fn(
        () =>
          ({
            popUpContextMenu: vi.fn(),
            setContextMenu: vi.fn(),
            setToolTip: vi.fn(),
          }) as unknown as Tray,
      ),
      icon: "icon" as unknown as NativeImage,
      openMeetUrl: vi.fn(() => Promise.resolve(err(meetWindowError))),
      quitApp: vi.fn(),
      reportError,
      showSettingsWindow: vi.fn(),
      syncNow: vi.fn(() => Promise.resolve(err(syncError))),
    });

    controller.updateMeetings({ meetings: [meeting] });
    const latestMenu = menus.at(-1) ?? [];

    clickItem(
      latestMenu.find((item) => item.label === "10:00 Product sync") as MenuItemConstructorOptions,
    );
    clickItem(latestMenu.find((item) => item.label === "Sync Now") as MenuItemConstructorOptions);

    await vi.waitFor(() => {
      expect(reportError).toHaveBeenCalledWith(
        "Failed to open Meet from the menu bar.",
        expect.objectContaining({ type: "MeetWindowFailed" }),
      );
      expect(reportError).toHaveBeenCalledWith(
        "Failed to sync Calendar from the menu bar.",
        expect.objectContaining({ type: "CalendarApiFailed" }),
      );
    });
  });
});

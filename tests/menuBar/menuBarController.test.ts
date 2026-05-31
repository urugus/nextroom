import { buildMenuBarTemplate, createMenuBarController } from "@main/menuBar/menuBarController";
import type { MeetEvent } from "@shared/types";
import type { Menu, MenuItemConstructorOptions, NativeImage, Tray } from "electron";
import { ok } from "neverthrow";
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
});

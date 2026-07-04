import {
  defaultAppSettings,
  parseSettingsUpdate,
  parseStoredAppSettings,
  validateAppSettings,
} from "@main/settings/appSettings";
import { describe, expect, it } from "vitest";

describe("app settings", () => {
  it("loads auto-join defaults for older settings files", () => {
    expect(parseStoredAppSettings({ openOffsetSeconds: 5 * 60 })).toMatchObject({
      autoJoinEnabled: false,
      cameraBubbleChatMirrorEnabled: false,
      cameraBubbleEnabled: false,
      cameraBubbleScreenShareDanmakuEnabled: false,
      cameraBubbleSidebarHidden: false,
      cameraBubbleDisplaySpeedLevel: 3,
      joinOffsetSeconds: 0,
      menuShortcutAccelerator: "Command+Alt+N",
      openOffsetSeconds: 5 * 60,
    });
  });

  it("clamps inconsistent stored auto-join offsets", () => {
    expect(
      parseStoredAppSettings({
        autoJoinEnabled: false,
        joinOffsetSeconds: 5 * 60,
        openOffsetSeconds: 3 * 60,
      }),
    ).toMatchObject({
      joinOffsetSeconds: 3 * 60,
      openOffsetSeconds: 3 * 60,
    });
  });

  it("accepts partial auto-join setting updates", () => {
    expect(parseSettingsUpdate({ autoJoinEnabled: true })._unsafeUnwrap()).toEqual({
      autoJoinEnabled: true,
    });
  });

  it("accepts launch-at-login, auto-open, and notification updates", () => {
    expect(parseSettingsUpdate({ launchAtLogin: true })._unsafeUnwrap()).toEqual({
      launchAtLogin: true,
    });
    expect(parseSettingsUpdate({ autoOpenEnabled: false })._unsafeUnwrap()).toEqual({
      autoOpenEnabled: false,
    });
    expect(parseSettingsUpdate({ notifyBeforeMinutes: 5 })._unsafeUnwrap()).toEqual({
      notifyBeforeMinutes: 5,
    });
    expect(parseSettingsUpdate({ notifyBeforeMinutes: 0 })._unsafeUnwrap()).toEqual({
      notifyBeforeMinutes: 0,
    });
  });

  it("rejects out-of-range notification offsets", () => {
    expect(parseSettingsUpdate({ notifyBeforeMinutes: -1 }).isErr()).toBe(true);
    expect(parseSettingsUpdate({ notifyBeforeMinutes: 61 }).isErr()).toBe(true);
    expect(parseSettingsUpdate({ notifyBeforeMinutes: 1.5 }).isErr()).toBe(true);
  });

  it("clamps oversized stored notification offsets", () => {
    expect(parseStoredAppSettings({ notifyBeforeMinutes: 120 })).toMatchObject({
      notifyBeforeMinutes: 60,
    });
    expect(parseStoredAppSettings({ notifyBeforeMinutes: 60 })).toMatchObject({
      notifyBeforeMinutes: 60,
    });
    expect(parseStoredAppSettings({})).toMatchObject({
      notifyBeforeMinutes: 1,
    });
  });

  it("accepts camera bubble setting updates", () => {
    expect(parseSettingsUpdate({ cameraBubbleEnabled: true })._unsafeUnwrap()).toEqual({
      cameraBubbleEnabled: true,
    });
    expect(parseSettingsUpdate({ cameraBubbleChatMirrorEnabled: true })._unsafeUnwrap()).toEqual({
      cameraBubbleChatMirrorEnabled: true,
    });
    expect(
      parseSettingsUpdate({ cameraBubbleScreenShareDanmakuEnabled: true })._unsafeUnwrap(),
    ).toEqual({
      cameraBubbleScreenShareDanmakuEnabled: true,
    });
    expect(parseSettingsUpdate({ cameraBubbleSidebarHidden: true })._unsafeUnwrap()).toEqual({
      cameraBubbleSidebarHidden: true,
    });
  });

  it("defaults screen share danmaku comments to false", () => {
    expect(defaultAppSettings.cameraBubbleScreenShareDanmakuEnabled).toBe(false);
    expect(parseStoredAppSettings({}).cameraBubbleScreenShareDanmakuEnabled).toBe(false);
  });

  it("defaults the camera bubble sidebar hidden state to false", () => {
    expect(defaultAppSettings.cameraBubbleSidebarHidden).toBe(false);
    expect(parseStoredAppSettings({}).cameraBubbleSidebarHidden).toBe(false);
  });

  it("defaults the camera bubble display speed level to 3", () => {
    expect(defaultAppSettings.cameraBubbleDisplaySpeedLevel).toBe(3);
    expect(parseStoredAppSettings({}).cameraBubbleDisplaySpeedLevel).toBe(3);
  });

  it("accepts camera bubble display speed levels from 1 to 5", () => {
    [1, 2, 3, 4, 5].forEach((cameraBubbleDisplaySpeedLevel) => {
      expect(parseSettingsUpdate({ cameraBubbleDisplaySpeedLevel })._unsafeUnwrap()).toEqual({
        cameraBubbleDisplaySpeedLevel,
      });
    });
  });

  it("rejects camera bubble display speed levels outside the allowed integer range", () => {
    expect(
      parseSettingsUpdate({ cameraBubbleDisplaySpeedLevel: 0 })._unsafeUnwrapErr(),
    ).toMatchObject({
      type: "DatabaseFailed",
    });
    expect(
      parseSettingsUpdate({ cameraBubbleDisplaySpeedLevel: 6 })._unsafeUnwrapErr(),
    ).toMatchObject({
      type: "DatabaseFailed",
    });
    expect(
      parseSettingsUpdate({ cameraBubbleDisplaySpeedLevel: 1.5 })._unsafeUnwrapErr(),
    ).toMatchObject({
      type: "DatabaseFailed",
    });
  });

  it("rejects non-boolean camera bubble updates", () => {
    expect(parseSettingsUpdate({ cameraBubbleEnabled: "true" })._unsafeUnwrapErr()).toMatchObject({
      type: "DatabaseFailed",
    });
    expect(
      parseSettingsUpdate({ cameraBubbleSidebarHidden: "true" })._unsafeUnwrapErr(),
    ).toMatchObject({
      type: "DatabaseFailed",
    });
  });

  it("accepts menu shortcut updates and clearing", () => {
    expect(
      parseSettingsUpdate({ menuShortcutAccelerator: "Command+Alt+M" })._unsafeUnwrap(),
    ).toEqual({
      menuShortcutAccelerator: "Command+Alt+M",
    });
    expect(parseSettingsUpdate({ menuShortcutAccelerator: null })._unsafeUnwrap()).toEqual({
      menuShortcutAccelerator: null,
    });
  });

  it("loads valid stored settings and falls back for invalid stored settings", () => {
    expect(
      parseStoredAppSettings({
        autoJoinEnabled: true,
        autoOpenEnabled: false,
        calendarId: "primary",
        launchAtLogin: true,
        menuShortcutAccelerator: null,
        notifyBeforeMinutes: 5,
        timezone: "Asia/Tokyo",
      }),
    ).toMatchObject({
      autoJoinEnabled: true,
      autoOpenEnabled: false,
      launchAtLogin: true,
      menuShortcutAccelerator: null,
      notifyBeforeMinutes: 5,
      timezone: "Asia/Tokyo",
    });
    expect(parseStoredAppSettings({ extra: true })).toEqual(defaultAppSettings);
  });

  it("accepts open offset and menu shortcut bounds and rejects invalid updates", () => {
    expect(parseSettingsUpdate({ openOffsetSeconds: 10 * 60 })._unsafeUnwrap()).toEqual({
      openOffsetSeconds: 10 * 60,
    });
    expect(
      parseSettingsUpdate({ menuShortcutAccelerator: "  Command+Alt+N  " })._unsafeUnwrap(),
    ).toEqual({
      menuShortcutAccelerator: "Command+Alt+N",
    });
    expect(parseSettingsUpdate({ openOffsetSeconds: 11 * 60 })._unsafeUnwrapErr()).toMatchObject({
      type: "DatabaseFailed",
    });
    expect(parseSettingsUpdate({ unknown: true })._unsafeUnwrapErr()).toMatchObject({
      type: "DatabaseFailed",
    });
    expect(parseSettingsUpdate({ menuShortcutAccelerator: "" })._unsafeUnwrapErr()).toMatchObject({
      type: "DatabaseFailed",
    });
  });

  it("rejects auto-join offsets that are not whole minutes", () => {
    expect(parseSettingsUpdate({ joinOffsetSeconds: 90 })._unsafeUnwrapErr()).toMatchObject({
      type: "DatabaseFailed",
    });
  });

  it("validates the merged settings invariant", () => {
    const result = validateAppSettings({
      ...defaultAppSettings,
      autoJoinEnabled: true,
      joinOffsetSeconds: 5 * 60,
      openOffsetSeconds: 3 * 60,
    });

    expect(result._unsafeUnwrapErr()).toMatchObject({
      cause: "joinOffsetSeconds must be less than or equal to openOffsetSeconds",
      type: "DatabaseFailed",
    });
  });

  it("accepts valid merged settings", () => {
    expect(validateAppSettings(defaultAppSettings)._unsafeUnwrap()).toEqual(defaultAppSettings);
  });
});

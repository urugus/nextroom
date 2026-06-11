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
      cameraBubbleEnabled: false,
      cameraBubbleFadeSpeedLevel: 3,
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

  it("accepts camera bubble setting updates", () => {
    expect(parseSettingsUpdate({ cameraBubbleEnabled: true })._unsafeUnwrap()).toEqual({
      cameraBubbleEnabled: true,
    });
  });

  it("defaults the camera bubble fade speed level to 3", () => {
    expect(defaultAppSettings.cameraBubbleFadeSpeedLevel).toBe(3);
    expect(parseStoredAppSettings({}).cameraBubbleFadeSpeedLevel).toBe(3);
  });

  it("accepts camera bubble fade speed levels from 1 to 5", () => {
    [1, 2, 3, 4, 5].forEach((cameraBubbleFadeSpeedLevel) => {
      expect(parseSettingsUpdate({ cameraBubbleFadeSpeedLevel })._unsafeUnwrap()).toEqual({
        cameraBubbleFadeSpeedLevel,
      });
    });
  });

  it("rejects camera bubble fade speed levels outside the allowed integer range", () => {
    expect(parseSettingsUpdate({ cameraBubbleFadeSpeedLevel: 0 })._unsafeUnwrapErr()).toMatchObject(
      {
        type: "DatabaseFailed",
      },
    );
    expect(parseSettingsUpdate({ cameraBubbleFadeSpeedLevel: 6 })._unsafeUnwrapErr()).toMatchObject(
      {
        type: "DatabaseFailed",
      },
    );
    expect(
      parseSettingsUpdate({ cameraBubbleFadeSpeedLevel: 1.5 })._unsafeUnwrapErr(),
    ).toMatchObject({
      type: "DatabaseFailed",
    });
  });

  it("rejects non-boolean camera bubble updates", () => {
    expect(parseSettingsUpdate({ cameraBubbleEnabled: "true" })._unsafeUnwrapErr()).toMatchObject({
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
});

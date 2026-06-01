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

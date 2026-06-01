import { createMenuShortcutRegistrar } from "@main/shortcuts/menuShortcut";
import { describe, expect, it, vi } from "vitest";

describe("createMenuShortcutRegistrar", () => {
  it("registers the shortcut and opens the menu when it fires", () => {
    let callback: (() => void) | undefined;
    const openMenu = vi.fn();
    const registrar = createMenuShortcutRegistrar({
      globalShortcut: {
        register: vi.fn((_accelerator, nextCallback) => {
          callback = nextCallback;
          return true;
        }),
        unregister: vi.fn(),
      },
      openMenu,
      reportError: vi.fn(),
    });

    expect(registrar.updateShortcut("Command+Alt+N").isOk()).toBe(true);
    callback?.();

    expect(openMenu).toHaveBeenCalledTimes(1);
  });

  it("unregisters the previous shortcut before registering a new one", () => {
    const unregister = vi.fn();
    const registrar = createMenuShortcutRegistrar({
      globalShortcut: {
        register: vi.fn(() => true),
        unregister,
      },
      openMenu: vi.fn(),
      reportError: vi.fn(),
    });

    expect(registrar.updateShortcut("Command+Alt+N").isOk()).toBe(true);
    expect(registrar.updateShortcut("Command+Alt+M").isOk()).toBe(true);

    expect(unregister).toHaveBeenCalledWith("Command+Alt+N");
  });

  it("reports unavailable shortcuts without keeping them registered", () => {
    const unregister = vi.fn();
    const reportError = vi.fn();
    const registrar = createMenuShortcutRegistrar({
      globalShortcut: {
        register: vi.fn(() => false),
        unregister,
      },
      openMenu: vi.fn(),
      reportError,
    });

    expect(registrar.updateShortcut("Command+Alt+N")._unsafeUnwrapErr()).toMatchObject({
      accelerator: "Command+Alt+N",
      type: "ShortcutRegistrationFailed",
    });
    registrar.unregister();

    expect(reportError).toHaveBeenCalledWith(
      "Failed to register the menu shortcut.",
      expect.objectContaining({ type: "ShortcutRegistrationFailed" }),
    );
    expect(unregister).not.toHaveBeenCalled();
  });

  it("restores the previous shortcut when a replacement cannot be registered", () => {
    const register = vi.fn((accelerator: string) => accelerator !== "Command+Alt+M");
    const unregister = vi.fn();
    const registrar = createMenuShortcutRegistrar({
      globalShortcut: {
        register,
        unregister,
      },
      openMenu: vi.fn(),
      reportError: vi.fn(),
    });

    expect(registrar.updateShortcut("Command+Alt+N").isOk()).toBe(true);
    expect(registrar.updateShortcut("Command+Alt+M").isErr()).toBe(true);

    expect(unregister).toHaveBeenCalledWith("Command+Alt+N");
    expect(register).toHaveBeenLastCalledWith("Command+Alt+N", expect.any(Function));
  });
});

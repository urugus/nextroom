import type { AppError } from "@shared/errors";
import { err, ok, type Result } from "neverthrow";

type GlobalShortcut = {
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
};

type MenuShortcutRegistrarInput = {
  globalShortcut: GlobalShortcut;
  openMenu: () => void;
  reportError: (message: string, cause: unknown) => void;
};

export type MenuShortcutRegistrar = {
  updateShortcut: (accelerator: string | null) => Result<void, AppError>;
  unregister: () => void;
};

export const createMenuShortcutRegistrar = ({
  globalShortcut,
  openMenu,
  reportError,
}: MenuShortcutRegistrarInput): MenuShortcutRegistrar => {
  let registeredAccelerator: string | undefined;

  const unregister = (): void => {
    if (registeredAccelerator === undefined) return;

    globalShortcut.unregister(registeredAccelerator);
    registeredAccelerator = undefined;
  };

  const register = (accelerator: string): Result<void, AppError> => {
    try {
      const registered = globalShortcut.register(accelerator, openMenu);
      if (!registered) {
        const error: AppError = {
          accelerator,
          cause: `${accelerator} is already in use or unavailable.`,
          type: "ShortcutRegistrationFailed",
        };
        reportError("Failed to register the menu shortcut.", error);
        return err(error);
      }

      registeredAccelerator = accelerator;
      return ok(undefined);
    } catch (cause) {
      const error: AppError = {
        accelerator,
        cause,
        type: "ShortcutRegistrationFailed",
      };
      reportError("Failed to register the menu shortcut.", error);
      return err(error);
    }
  };

  return {
    updateShortcut: (accelerator) => {
      const previousAccelerator = registeredAccelerator;

      unregister();
      if (accelerator === null) return ok(undefined);

      const registered = register(accelerator);
      if (registered.isOk()) return registered;

      if (previousAccelerator !== undefined) {
        const restored = register(previousAccelerator);
        if (restored.isErr()) {
          reportError("Failed to restore the previous menu shortcut.", restored.error);
        }
      }

      return registered;
    },
    unregister,
  };
};

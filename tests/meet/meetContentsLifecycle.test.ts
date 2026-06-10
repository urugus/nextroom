import { closeMeetContentsOnWindowClosed } from "@main/meet/meetContentsLifecycle";
import { describe, expect, it, vi } from "vitest";

const createFakeWindow = () => {
  const listeners: (() => void)[] = [];

  return {
    emitClosed: () => {
      for (const listener of listeners) {
        listener();
      }
    },
    on: vi.fn((_event: "closed", listener: () => void) => {
      listeners.push(listener);
    }),
  };
};

const createFakeContents = (destroyed = false) => ({
  close: vi.fn(),
  isDestroyed: vi.fn(() => destroyed),
});

describe("closeMeetContentsOnWindowClosed", () => {
  it("closes the Meet web contents when the window is closed", () => {
    const window = createFakeWindow();
    const contents = createFakeContents();

    closeMeetContentsOnWindowClosed(window, contents);

    expect(contents.close).not.toHaveBeenCalled();

    window.emitClosed();

    expect(contents.close).toHaveBeenCalledTimes(1);
  });

  it("does not close web contents that are already destroyed", () => {
    const window = createFakeWindow();
    const contents = createFakeContents(true);

    closeMeetContentsOnWindowClosed(window, contents);
    window.emitClosed();

    expect(contents.close).not.toHaveBeenCalled();
  });
});

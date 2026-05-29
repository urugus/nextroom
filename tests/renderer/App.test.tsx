import { App } from "@renderer/App";
import type { ApiResult } from "@shared/ipc";
import type { AppUpdateStatus } from "@shared/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const installMeetLauncher = (openMeetUrl: ReturnType<typeof vi.fn>) => {
  const updateStatus: AppUpdateStatus = {
    canCheck: false,
    canDownload: false,
    canInstall: false,
    currentVersion: "0.1.0",
    status: "unsupported",
  };

  Object.defineProperty(window, "meetLauncher", {
    configurable: true,
    value: {
      checkForUpdates: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      downloadUpdate: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      getAccountStatus: vi.fn(),
      getUpdateStatus: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      installUpdate: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
      onUpdateStatusChanged: vi.fn(() => vi.fn()),
      openMeetUrl,
      versions: {
        chrome: "test-chrome",
        electron: "test-electron",
      },
    },
  });
};

const okResult: ApiResult<void> = { ok: true, value: undefined };

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a meeting through the preload API and shows loading state", async () => {
    let resolveOpen!: (value: ApiResult<void>) => void;
    const openPromise = new Promise<ApiResult<void>>((resolve) => {
      resolveOpen = resolve;
    });
    const openMeetUrl = vi.fn(() => openPromise);
    installMeetLauncher(openMeetUrl);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    const openingButton = await screen.findByRole("button", { name: "Opening" });
    expect(openingButton).toBeDisabled();

    fireEvent.click(openingButton);
    expect(openMeetUrl).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveOpen(okResult);
      await openPromise;
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Join" })).toBeEnabled());
    expect(openMeetUrl).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
  });

  it("renders an IPC error response", async () => {
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() =>
      Promise.resolve({
        ok: false,
        error: {
          message: "Google Meet window failed: network error",
          recoverable: true,
          type: "MeetWindowFailed",
        },
      }),
    );
    installMeetLauncher(openMeetUrl);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    expect(await screen.findByText("Google Meet window failed: network error")).toBeInTheDocument();
  });

  it("renders thrown preload errors", async () => {
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() =>
      Promise.reject(new Error("preload bridge unavailable")),
    );
    installMeetLauncher(openMeetUrl);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    expect(await screen.findByText("preload bridge unavailable")).toBeInTheDocument();
  });
});

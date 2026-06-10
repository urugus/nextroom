type ClosableWebContents = {
  close: () => void;
  isDestroyed: () => boolean;
};

type ClosableWindow = {
  on: (event: "closed", listener: () => void) => unknown;
};

// Electron does not destroy a WebContentsView's webContents when its host
// window closes, so the Meet page (and its WebRTC session) would keep running
// invisibly. Close it explicitly once the window is gone.
export const closeMeetContentsOnWindowClosed = (
  window: ClosableWindow,
  contents: ClosableWebContents,
): void => {
  window.on("closed", () => {
    if (!contents.isDestroyed()) {
      contents.close();
    }
  });
};

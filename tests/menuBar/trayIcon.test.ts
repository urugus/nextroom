import { createTrayIcon } from "@main/menuBar/trayIcon";
import type { NativeImage } from "electron";
import { describe, expect, it, vi } from "vitest";

const createMockNativeImage = (isEmpty: boolean) => {
  const resizedImage = {
    setTemplateImage: vi.fn(),
  } as unknown as NativeImage;
  const image = {
    isEmpty: vi.fn(() => isEmpty),
    resize: vi.fn(() => resizedImage),
  } as unknown as NativeImage;
  const nativeImage = {
    createFromPath: vi.fn(() => image),
  };

  return { image, nativeImage, resizedImage };
};

describe("createTrayIcon", () => {
  it("loads the tray icon, resizes it, and marks it as a macOS template image", () => {
    const { image, nativeImage, resizedImage } = createMockNativeImage(false);

    const trayIcon = createTrayIcon({
      iconPath: "/app/assets/nextroom-tray-icon.png",
      nativeImage,
      platform: "darwin",
    });

    expect(nativeImage.createFromPath).toHaveBeenCalledWith("/app/assets/nextroom-tray-icon.png");
    expect(image.resize).toHaveBeenCalledWith({ height: 18, width: 18 });
    expect(resizedImage.setTemplateImage).toHaveBeenCalledWith(true);
    expect(trayIcon).toBe(resizedImage);
  });

  it("fails fast when the tray icon asset cannot be loaded", () => {
    const { image, nativeImage } = createMockNativeImage(true);

    expect(() =>
      createTrayIcon({
        iconPath: "/app/assets/missing.png",
        nativeImage,
        platform: "darwin",
      }),
    ).toThrow("Failed to load tray icon: /app/assets/missing.png");
    expect(image.resize).not.toHaveBeenCalled();
  });
});

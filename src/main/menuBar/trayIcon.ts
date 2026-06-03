import type { NativeImage } from "electron";

type NativeImageFactory = {
  createFromPath: (path: string) => NativeImage;
};

type CreateTrayIconOptions = {
  iconPath: string;
  nativeImage: NativeImageFactory;
  platform?: NodeJS.Platform;
};

export const createTrayIcon = ({
  iconPath,
  nativeImage,
  platform = process.platform,
}: CreateTrayIconOptions): NativeImage => {
  const image = nativeImage.createFromPath(iconPath);

  if (image.isEmpty()) {
    throw new Error(`Failed to load tray icon: ${iconPath}`);
  }

  const resizedImage = image.resize({ height: 18, width: 18 });

  if (platform === "darwin") {
    resizedImage.setTemplateImage(true);
  }

  return resizedImage;
};

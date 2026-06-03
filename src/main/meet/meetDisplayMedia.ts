import type { ScreenShareSource } from "@shared/types";
import type { Session } from "electron";
import { isMeetOrigin } from "./meetSessionPermissions";

type DisplayMediaRequestHandler = NonNullable<
  Parameters<Session["setDisplayMediaRequestHandler"]>[0]
>;
type DisplayMediaRequest = Parameters<DisplayMediaRequestHandler>[0];
type DisplayMediaCallback = Parameters<DisplayMediaRequestHandler>[1];
type DisplayMediaStreams = Parameters<DisplayMediaCallback>[0];
export type ScreenAccessStatus = "denied" | "granted" | "not-determined" | "restricted" | "unknown";

type ImageLike = {
  isEmpty: () => boolean;
  toDataURL: () => string;
};

export type CapturableScreenShareSource = {
  appIcon?: ImageLike | null;
  id: string;
  name: string;
  thumbnail: ImageLike;
};

type ConfigureMeetDisplayMediaHandlerInput = {
  chooseSource: (sources: ScreenShareSource[]) => Promise<ScreenShareSource | undefined>;
  getScreenAccessStatus: () => ScreenAccessStatus;
  getSources: () => Promise<CapturableScreenShareSource[]>;
  meetSession: Pick<Session, "setDisplayMediaRequestHandler">;
  notifyScreenAccessDenied?: () => void;
};

const deniedStreams = (): DisplayMediaStreams => ({});

export const toScreenShareSource = (source: CapturableScreenShareSource): ScreenShareSource => {
  const appIconDataUrl =
    source.appIcon !== null && source.appIcon !== undefined && !source.appIcon.isEmpty()
      ? source.appIcon.toDataURL()
      : undefined;

  return {
    appIconDataUrl,
    id: source.id,
    kind: source.id.startsWith("screen:") ? "screen" : "window",
    name: source.name,
    thumbnailDataUrl: source.thumbnail.toDataURL(),
  };
};

export const handleMeetDisplayMediaRequest = async (
  request: DisplayMediaRequest,
  {
    chooseSource,
    getScreenAccessStatus,
    getSources,
    notifyScreenAccessDenied = () => undefined,
  }: Omit<ConfigureMeetDisplayMediaHandlerInput, "meetSession">,
): Promise<DisplayMediaStreams> => {
  if (!isMeetOrigin(request.securityOrigin)) return deniedStreams();
  if (!request.videoRequested) return deniedStreams();
  if (!request.userGesture) return deniedStreams();

  const screenAccessStatus = getScreenAccessStatus();
  if (screenAccessStatus === "denied" || screenAccessStatus === "restricted") {
    notifyScreenAccessDenied();
    return deniedStreams();
  }

  let capturableSources: CapturableScreenShareSource[];
  try {
    capturableSources = await getSources();
  } catch {
    return deniedStreams();
  }
  if (capturableSources.length === 0) return deniedStreams();

  const selectedSource = await chooseSource(capturableSources.map(toScreenShareSource));
  if (selectedSource === undefined) return deniedStreams();

  const capturableSource = capturableSources.find((source) => source.id === selectedSource.id);
  if (capturableSource === undefined) return deniedStreams();

  return {
    video: {
      id: capturableSource.id,
      name: capturableSource.name,
    },
  };
};

export const configureMeetDisplayMediaHandler = ({
  meetSession,
  ...input
}: ConfigureMeetDisplayMediaHandlerInput): void => {
  meetSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      void handleMeetDisplayMediaRequest(request, input)
        .then(callback)
        .catch(() => {
          callback(deniedStreams());
        });
    },
    { useSystemPicker: true },
  );
};

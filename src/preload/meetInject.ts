import { ipcRenderer, webFrame } from "electron";
import { installCameraBubbleHook } from "./cameraBubbleHook";
import {
  computeBubbleAlpha,
  computeBubbleDisplayDurationMs,
  computeBubbleLayout,
  computeCanvasSize,
  computeOverlayBox,
  hasVideoConstraints,
  isDisplayCaptureLike,
  parseCameraBubbleEnvelope,
  sanitizeBubbleText,
  scoreSelfViewCandidate,
  shouldMirrorChatKey,
  wrapBubbleLines,
} from "./cameraBubblePure";

const IPC_CHANNELS = {
  meetBubbleConfig: "meetBubble:config",
  meetBubbleShow: "meetBubble:show",
} as const;

const argumentValueFor = (name: string): string | undefined =>
  process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(`${name}=`.length);

const parseBooleanFlag = (name: string): boolean => argumentValueFor(name) === "1";

const parseSpeedLevelFlag = (name: string): number => {
  const parsed = Number(argumentValueFor(name));
  if (!Number.isFinite(parsed)) return 3;

  return Math.max(1, Math.min(5, Math.floor(parsed)));
};

const initialConfig = {
  chatMirrorEnabled: parseBooleanFlag("--nextroom-camera-bubble-chat"),
  displaySpeedLevel: parseSpeedLevelFlag("--nextroom-camera-bubble-speed"),
  enabled: parseBooleanFlag("--nextroom-camera-bubble"),
};

const createCameraBubbleNonce = (): string => {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const cameraBubbleNonce = createCameraBubbleNonce();

type CameraBubbleMessage =
  | { chatMirrorEnabled: boolean; displaySpeedLevel: number; enabled: boolean; kind: "config" }
  | { durationMs: number; kind: "show"; text: string };

const postToMainWorld = (payload: CameraBubbleMessage): void => {
  window.postMessage({ __nextroomCameraBubble: { nonce: cameraBubbleNonce, ...payload } }, "*");
};

if (typeof webFrame?.executeJavaScript === "function") {
  const cameraBubbleDeps = `{
    computeBubbleAlpha: ${computeBubbleAlpha.toString()},
    computeBubbleDisplayDurationMs: ${computeBubbleDisplayDurationMs.toString()},
    computeBubbleLayout: ${computeBubbleLayout.toString()},
    computeOverlayBox: ${computeOverlayBox.toString()},
    computeCanvasSize: ${computeCanvasSize.toString()},
    hasVideoConstraints: ${hasVideoConstraints.toString()},
    isDisplayCaptureLike: ${isDisplayCaptureLike.toString()},
    parseCameraBubbleEnvelope: ${parseCameraBubbleEnvelope.toString()},
    sanitizeBubbleText: ${sanitizeBubbleText.toString()},
    scoreSelfViewCandidate: ${scoreSelfViewCandidate.toString()},
    shouldMirrorChatKey: ${shouldMirrorChatKey.toString()},
    wrapBubbleLines: ${wrapBubbleLines.toString()}
  }`;
  void webFrame.executeJavaScript(
    `(${installCameraBubbleHook.toString()})(${JSON.stringify(
      initialConfig,
    )}, ${cameraBubbleDeps}, ${JSON.stringify(cameraBubbleNonce)})`,
  );
} else {
  // oxlint-disable-next-line no-console -- Required preload diagnostic when injection is unavailable.
  console.warn("NextRoom camera bubble preload could not inject the Meet hook.");
}

ipcRenderer.on(IPC_CHANNELS.meetBubbleShow, (_event, payload: unknown) => {
  const message =
    typeof payload === "object" && payload !== null
      ? (payload as { durationMs?: unknown; text?: unknown })
      : { durationMs: undefined, text: payload };
  if (typeof message.text !== "string") {
    return;
  }

  postToMainWorld({
    durationMs: Number(message.durationMs),
    kind: "show",
    text: message.text,
  });
});

ipcRenderer.on(IPC_CHANNELS.meetBubbleConfig, (_event, payload: unknown) => {
  const config =
    typeof payload === "object" && payload !== null
      ? (payload as {
          chatMirrorEnabled?: unknown;
          displaySpeedLevel?: unknown;
          enabled?: unknown;
        })
      : {
          chatMirrorEnabled: undefined,
          displaySpeedLevel: undefined,
          enabled: undefined,
        };
  postToMainWorld({
    chatMirrorEnabled: config.chatMirrorEnabled === true,
    displaySpeedLevel: Number(config.displaySpeedLevel),
    enabled: config.enabled === true,
    kind: "config",
  });
});

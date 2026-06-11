import { ipcRenderer, webFrame } from "electron";
import { installCameraBubbleHook } from "./cameraBubbleHook";
import {
  computeBubbleAlpha,
  computeBubbleLayout,
  computeCanvasSize,
  hasVideoConstraints,
  parseCameraBubbleEnvelope,
  wrapBubbleLines,
} from "./cameraBubblePure";

const IPC_CHANNELS = {
  meetBubbleSetEnabled: "meetBubble:setEnabled",
  meetBubbleShow: "meetBubble:show",
} as const;

const initialEnabled = process.argv.includes("--nextroom-camera-bubble=1");

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
  | { enabled: boolean; kind: "setEnabled" }
  | { durationMs: number; kind: "show"; text: string };

const postToMainWorld = (payload: CameraBubbleMessage): void => {
  window.postMessage({ __nextroomCameraBubble: { nonce: cameraBubbleNonce, ...payload } }, "*");
};

if (typeof webFrame?.executeJavaScript === "function") {
  const cameraBubbleDeps = `{
    computeBubbleAlpha: ${computeBubbleAlpha.toString()},
    computeBubbleLayout: ${computeBubbleLayout.toString()},
    computeCanvasSize: ${computeCanvasSize.toString()},
    hasVideoConstraints: ${hasVideoConstraints.toString()},
    parseCameraBubbleEnvelope: ${parseCameraBubbleEnvelope.toString()},
    wrapBubbleLines: ${wrapBubbleLines.toString()}
  }`;
  void webFrame.executeJavaScript(
    `(${installCameraBubbleHook.toString()})(${JSON.stringify(
      initialEnabled,
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
  postToMainWorld({
    durationMs: Number(message.durationMs),
    kind: "show",
    text: String(message.text),
  });
});

ipcRenderer.on(IPC_CHANNELS.meetBubbleSetEnabled, (_event, payload: unknown) => {
  postToMainWorld({ enabled: payload === true, kind: "setEnabled" });
});

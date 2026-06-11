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
const cameraBubbleNonce =
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

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

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

type CameraBubbleMessage =
  | { enabled: boolean; kind: "setEnabled" }
  | { kind: "show"; text: string };

const postToMainWorld = (payload: CameraBubbleMessage): void => {
  window.postMessage({ __nextroomCameraBubble: payload }, "*");
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
    `(${installCameraBubbleHook.toString()})(${JSON.stringify(initialEnabled)}, ${cameraBubbleDeps})`,
  );
} else {
  // oxlint-disable-next-line no-console -- Required preload diagnostic when injection is unavailable.
  console.warn("NextRoom camera bubble preload could not inject the Meet hook.");
}

ipcRenderer.on(IPC_CHANNELS.meetBubbleShow, (_event, payload: unknown) => {
  postToMainWorld({ kind: "show", text: String(payload) });
});

ipcRenderer.on(IPC_CHANNELS.meetBubbleSetEnabled, (_event, payload: unknown) => {
  postToMainWorld({ enabled: payload === true, kind: "setEnabled" });
});

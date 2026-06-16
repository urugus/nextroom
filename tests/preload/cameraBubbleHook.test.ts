import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCameraBubbleHook } from "../../src/preload/cameraBubbleHook";
import {
  computeBubbleAnimation,
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
} from "../../src/preload/cameraBubblePure";

type FakeMediaStreamTrack = MediaStreamTrack & {
  dispatchEnded: () => void;
  settings: MediaTrackSettings;
  stopMock: ReturnType<typeof vi.fn>;
};

type MediaStreamConstructor = new (tracks?: MediaStreamTrack[]) => MediaStream;
type MediaStreamTrackConstructor = new (
  kind: "audio" | "video",
  settings?: MediaTrackSettings,
  label?: string,
) => FakeMediaStreamTrack;
type RTCPeerConnectionConstructor = new () => RTCPeerConnection;
type RTCRtpSenderConstructor = new (track: MediaStreamTrack | null) => RTCRtpSender;

const cameraBubbleDeps = {
  computeBubbleAnimation,
  computeBubbleDisplayDurationMs,
  computeBubbleLayout,
  computeOverlayBox,
  computeCanvasSize,
  hasVideoConstraints,
  isDisplayCaptureLike,
  parseCameraBubbleEnvelope,
  sanitizeBubbleText,
  scoreSelfViewCandidate,
  shouldMirrorChatKey,
  wrapBubbleLines,
};
const expectedNonce = "hook-nonce";
const chatToastObserverPatchKey = Symbol.for("nextroom.cameraBubble.chatToastObserver");
const enabledConfig = {
  chatMirrorEnabled: true,
  displaySpeedLevel: 3,
  enabled: true,
};

const overlayWithText = (text: string): HTMLDivElement | undefined =>
  Array.from(document.querySelectorAll("div")).find(
    (element): element is HTMLDivElement =>
      element.textContent === text && element.style.pointerEvents === "none",
  );

const overlaysWithText = (text: string): HTMLDivElement[] =>
  Array.from(document.querySelectorAll("div")).filter(
    (element): element is HTMLDivElement =>
      element.textContent === text && element.style.pointerEvents === "none",
  );

const dispatchEnter = (element: Element, init: KeyboardEventInit = {}): void => {
  element.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      keyCode: 13,
      ...init,
    }),
  );
};

const dispatchInput = (element: Element): void => {
  element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
};

const dispatchMouseDown = (element: Element): void => {
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
};

const flushMutationObserver = async (): Promise<void> => {
  await Promise.resolve();
};

describe("installCameraBubbleHook", () => {
  const originalMediaStream = globalThis.MediaStream;
  const originalMediaStreamTrack = globalThis.MediaStreamTrack;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalRTCRtpSender = globalThis.RTCRtpSender;
  const originalMediaDevices = navigator.mediaDevices;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  const senderTrackState: { tracks: WeakMap<object, MediaStreamTrack | null> } = {
    tracks: new WeakMap(),
  };
  const animationCallbacks: FrameRequestCallback[] = [];

  const createFakeTrack = (
    kind: "audio" | "video",
    settings: MediaTrackSettings = {},
    label = `${kind} track`,
  ): FakeMediaStreamTrack =>
    new (globalThis.MediaStreamTrack as unknown as MediaStreamTrackConstructor)(
      kind,
      settings,
      label,
    );

  const createFakeStream = (tracks: MediaStreamTrack[] = []): MediaStream =>
    new (globalThis.MediaStream as unknown as MediaStreamConstructor)(tracks);

  const postCameraBubbleMessage = (
    message:
      | { durationMs?: number; kind: "show"; pinned?: boolean; text: string }
      | {
          chatMirrorEnabled: boolean;
          displaySpeedLevel: number;
          enabled: boolean;
          kind: "config";
        }
      | { kind: "hide" },
  ): void => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { __nextroomCameraBubble: { nonce: expectedNonce, ...message } },
        source: window,
      }),
    );
  };

  const createVisibleSelfView = (track: MediaStreamTrack): HTMLVideoElement => {
    const video = document.createElement("video");
    video.srcObject = createFakeStream([track]);
    video.muted = true;
    video.playsInline = true;
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 640 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 360 });
    Object.defineProperty(video, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          bottom: 380,
          height: 360,
          left: 20,
          right: 660,
          top: 20,
          width: 640,
          x: 20,
          y: 20,
        }) as DOMRect,
    });
    document.body.append(video);
    return video;
  };

  const nextAnimationFrame = (): void => {
    animationCallbacks.shift()?.(Date.now());
  };

  let addTrackMock: ReturnType<typeof vi.fn>;
  let addTransceiverMock: ReturnType<typeof vi.fn>;
  let replaceTrackMock: ReturnType<typeof vi.fn<(track: MediaStreamTrack | null) => Promise<void>>>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let getDisplayMedia: ReturnType<typeof vi.fn>;
  let createdCanvasTracks: FakeMediaStreamTrack[];
  let canvasContexts: Array<{
    beginPath: ReturnType<typeof vi.fn>;
    closePath: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    fill: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    lineTo: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
    moveTo: ReturnType<typeof vi.fn>;
    quadraticCurveTo: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    scale: ReturnType<typeof vi.fn>;
    translate: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    senderTrackState.tracks = new WeakMap();
    animationCallbacks.length = 0;
    createdCanvasTracks = [];
    canvasContexts = [];

    class FakeMediaStreamTrackClass extends EventTarget {
      applyConstraints = vi.fn(() => Promise.resolve());
      contentHint = "";
      enabled = true;
      getCapabilities = vi.fn(() => ({}));
      getConstraints = vi.fn(() => ({}));
      getSettings = vi.fn(() => this.settings);
      id: string;
      kind: "audio" | "video";
      label: string;
      muted = false;
      onended = null;
      onmute = null;
      onunmute = null;
      readyState: MediaStreamTrackState = "live";
      settings: MediaTrackSettings;
      stopMock = vi.fn(() => {
        this.readyState = "ended";
      });
      stop = this.stopMock;

      constructor(kind: "audio" | "video", settings: MediaTrackSettings = {}, label = kind) {
        super();
        this.id = `${kind}-${Math.random().toString(16).slice(2)}`;
        this.kind = kind;
        this.label = label;
        this.settings = settings;
      }

      dispatchEnded = (): void => {
        this.readyState = "ended";
        this.dispatchEvent(new Event("ended"));
      };
    }

    Object.defineProperty(FakeMediaStreamTrackClass.prototype, "clone", {
      configurable: true,
      value: new Proxy(vi.fn(), {
        apply: (_target, thisArgument) => {
          const source = thisArgument as FakeMediaStreamTrack;
          return createFakeTrack(source.kind as "audio" | "video", source.settings, source.label);
        },
      }),
    });

    class FakeMediaStreamClass {
      active = true;
      onaddtrack = null;
      onremovetrack = null;
      tracks: MediaStreamTrack[];

      constructor(tracks: MediaStreamTrack[] = []) {
        this.tracks = tracks;
      }

      addEventListener = vi.fn();
      addTrack = vi.fn((track: MediaStreamTrack) => {
        this.tracks = [...this.tracks, track];
      });
      clone = vi.fn(() => createFakeStream(this.tracks.map((track) => track.clone())));
      dispatchEvent = vi.fn();
      getAudioTracks = vi.fn(() => this.tracks.filter((track) => track.kind === "audio"));
      getTrackById = vi.fn((id: string) => this.tracks.find((track) => track.id === id) ?? null);
      getTracks = vi.fn(() => this.tracks);
      getVideoTracks = vi.fn(() => this.tracks.filter((track) => track.kind === "video"));
      removeEventListener = vi.fn();
      removeTrack = vi.fn((track: MediaStreamTrack) => {
        this.tracks = this.tracks.filter((candidate) => candidate !== track);
      });
    }

    class FakeRTCRtpSenderClass {
      readonly fakeSender = true;

      constructor(track: MediaStreamTrack | null) {
        senderTrackState.tracks.set(this, track);
      }
    }

    const originalTrackGetter = new Proxy(vi.fn(), {
      apply: (_target, thisArgument) => senderTrackState.tracks.get(thisArgument as object) ?? null,
    });
    replaceTrackMock = vi.fn((track: MediaStreamTrack | null) => {
      void track;
      return Promise.resolve();
    });
    Object.defineProperty(FakeRTCRtpSenderClass.prototype, "track", {
      configurable: true,
      get: originalTrackGetter,
    });
    Object.defineProperty(FakeRTCRtpSenderClass.prototype, "replaceTrack", {
      configurable: true,
      value: new Proxy(vi.fn(), {
        apply: (_target, thisArgument, argumentList) => {
          const [track] = argumentList as [MediaStreamTrack | null];
          replaceTrackMock(track);
          senderTrackState.tracks.set(thisArgument as object, track);
          return Promise.resolve();
        },
      }),
    });

    class FakeRTCPeerConnectionClass {
      readonly fakePeerConnection = true;
    }

    addTrackMock = vi.fn(
      (track: MediaStreamTrack) =>
        new (globalThis.RTCRtpSender as unknown as RTCRtpSenderConstructor)(track),
    );
    addTransceiverMock = vi.fn((trackOrKind: MediaStreamTrack | string) => ({
      currentDirection: null,
      direction: "sendrecv",
      mid: null,
      receiver: {},
      sender: new (globalThis.RTCRtpSender as unknown as RTCRtpSenderConstructor)(
        typeof trackOrKind === "string" ? null : trackOrKind,
      ),
      stop: vi.fn(),
    }));
    Object.defineProperty(FakeRTCPeerConnectionClass.prototype, "addTrack", {
      configurable: true,
      value: addTrackMock,
    });
    Object.defineProperty(FakeRTCPeerConnectionClass.prototype, "addTransceiver", {
      configurable: true,
      value: addTransceiverMock,
    });

    Object.defineProperty(globalThis, "MediaStreamTrack", {
      configurable: true,
      value: FakeMediaStreamTrackClass as unknown as MediaStreamTrackConstructor,
    });
    Object.defineProperty(globalThis, "MediaStream", {
      configurable: true,
      value: FakeMediaStreamClass as unknown as MediaStreamConstructor,
    });
    Object.defineProperty(globalThis, "RTCRtpSender", {
      configurable: true,
      value: FakeRTCRtpSenderClass as unknown as RTCRtpSenderConstructor,
    });
    Object.defineProperty(globalThis, "RTCPeerConnection", {
      configurable: true,
      value: FakeRTCPeerConnectionClass as unknown as RTCPeerConnectionConstructor,
    });

    getUserMedia = vi.fn();
    getDisplayMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getDisplayMedia,
        getUserMedia,
      },
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => {
        const context = {
          beginPath: vi.fn(),
          closePath: vi.fn(),
          drawImage: vi.fn(),
          fill: vi.fn(),
          fillRect: vi.fn(),
          fillText: vi.fn(),
          lineTo: vi.fn(),
          measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
          moveTo: vi.fn(),
          quadraticCurveTo: vi.fn(),
          restore: vi.fn(),
          save: vi.fn(),
          scale: vi.fn(),
          translate: vi.fn(),
        };
        canvasContexts.push(context);
        return context;
      }),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => {
        const canvasTrack = createFakeTrack("video", { height: 720, width: 1280 }, "canvas track");
        createdCanvasTracks.push(canvasTrack);
        return createFakeStream([canvasTrack]);
      }),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      configurable: true,
      get: () => 640,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      configurable: true,
      get: () => 360,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        animationCallbacks.push(callback);
        return animationCallbacks.length;
      }),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    const chatToastObserverRecord = Reflect.get(window, chatToastObserverPatchKey);
    const chatToastObserver =
      typeof chatToastObserverRecord === "object" &&
      chatToastObserverRecord !== null &&
      "original" in chatToastObserverRecord
        ? (chatToastObserverRecord as { original?: unknown }).original
        : undefined;
    if (chatToastObserver instanceof MutationObserver) {
      chatToastObserver.disconnect();
      Reflect.deleteProperty(window, chatToastObserverPatchKey);
    }
    Object.defineProperty(globalThis, "MediaStream", {
      configurable: true,
      value: originalMediaStream,
    });
    Object.defineProperty(globalThis, "MediaStreamTrack", {
      configurable: true,
      value: originalMediaStreamTrack,
    });
    Object.defineProperty(globalThis, "RTCPeerConnection", {
      configurable: true,
      value: originalRTCPeerConnection,
    });
    Object.defineProperty(globalThis, "RTCRtpSender", {
      configurable: true,
      value: originalRTCRtpSender,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: originalRequestAnimationFrame,
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: originalCancelAnimationFrame,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
    vi.useRealTimers();
  });

  it("wraps camera video tracks on addTrack and passes through audio, display, and disabled cases", async () => {
    const cameraTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    const audioTrack = createFakeTrack("audio");
    const displayTrack = createFakeTrack("video", {}, "Captured source");
    getDisplayMedia.mockResolvedValue(createFakeStream([displayTrack]));

    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const displayStream = await navigator.mediaDevices.getDisplayMedia();
    const peerConnection = new RTCPeerConnection();
    const cameraStream = createFakeStream([cameraTrack]);

    peerConnection.addTrack(cameraTrack, cameraStream);
    peerConnection.addTrack(audioTrack);
    peerConnection.addTrack(displayStream.getVideoTracks()[0]);

    expect(addTrackMock.mock.calls[0][0]).not.toBe(cameraTrack);
    expect(addTrackMock.mock.calls[0][0]).toBe(createdCanvasTracks[0]);
    expect(addTrackMock.mock.calls[0][1]).toBe(cameraStream);
    expect(addTrackMock.mock.calls[1][0]).toBe(audioTrack);
    expect(addTrackMock.mock.calls[2][0]).toBe(displayTrack);

    const disabledPeerConnection = new RTCPeerConnection();
    const disabledCameraTrack = createFakeTrack("video", {}, "Camera");
    postCameraBubbleMessage({ ...enabledConfig, enabled: false, kind: "config" });
    disabledPeerConnection.addTrack(disabledCameraTrack);

    expect(addTrackMock.mock.calls.at(-1)?.[0]).toBe(disabledCameraTrack);
  });

  it("reuses wrapped tracks on replaceTrack and passes through null and canvas tracks", async () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    const sender = new RTCPeerConnection().addTrack(sourceTrack);
    const canvasTrack = createdCanvasTracks[0];

    await sender.replaceTrack(null);
    await sender.replaceTrack(canvasTrack);
    await sender.replaceTrack(sourceTrack);

    expect(replaceTrackMock.mock.calls[0][0]).toBeNull();
    expect(replaceTrackMock.mock.calls[1][0]).toBe(canvasTrack);
    expect(replaceTrackMock.mock.calls[2][0]).toBe(canvasTrack);
    expect(createdCanvasTracks).toHaveLength(1);
  });

  it("wraps camera video tracks on addTransceiver and preserves init arguments", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    const init: RTCRtpTransceiverInit = {
      direction: "sendonly",
      sendEncodings: [{ rid: "high" }],
    };
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    new RTCPeerConnection().addTransceiver(sourceTrack, init);

    expect(addTransceiverMock.mock.calls[0][0]).toBe(createdCanvasTracks[0]);
    expect(addTransceiverMock.mock.calls[0][1]).toBe(init);
  });

  it("passes through string kind, display tracks, and disabled feature on addTransceiver", async () => {
    const displayTrack = createFakeTrack("video", {}, "Captured source");
    const disabledTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    getDisplayMedia.mockResolvedValue(createFakeStream([displayTrack]));
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const displayStream = await navigator.mediaDevices.getDisplayMedia();
    const peerConnection = new RTCPeerConnection();

    peerConnection.addTransceiver("video");
    peerConnection.addTransceiver(displayStream.getVideoTracks()[0]);
    postCameraBubbleMessage({ ...enabledConfig, enabled: false, kind: "config" });
    peerConnection.addTransceiver(disabledTrack);

    expect(addTransceiverMock.mock.calls[0][0]).toBe("video");
    expect(addTransceiverMock.mock.calls[1][0]).toBe(displayTrack);
    expect(addTransceiverMock.mock.calls[2][0]).toBe(disabledTrack);
    expect(createdCanvasTracks).toHaveLength(0);
  });

  it("reuses the same pipeline across addTrack and addTransceiver", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const peerConnection = new RTCPeerConnection();

    peerConnection.addTrack(sourceTrack);
    peerConnection.addTransceiver(sourceTrack);

    expect(addTrackMock.mock.calls[0][0]).toBe(createdCanvasTracks[0]);
    expect(addTransceiverMock.mock.calls[0][0]).toBe(createdCanvasTracks[0]);
    expect(createdCanvasTracks).toHaveLength(1);
  });

  it("does not reinstall patches when the hook is installed twice", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    new RTCPeerConnection().addTrack(sourceTrack);

    expect(addTrackMock).toHaveBeenCalledTimes(1);
    expect(createdCanvasTracks).toHaveLength(1);
  });

  it("falls back to the source track when a canvas pipeline cannot be created", () => {
    const noContextTrack = createFakeTrack("video", { height: 360, width: 640 }, "No context");
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => null),
    });
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    new RTCPeerConnection().addTrack(noContextTrack);

    expect(addTrackMock.mock.calls[0][0]).toBe(noContextTrack);
    expect(createdCanvasTracks).toHaveLength(0);
  });

  it("falls back to the source track when captureStream has no video track", () => {
    const noCanvasTrack = createFakeTrack("video", { height: 360, width: 640 }, "No canvas track");
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => createFakeStream([])),
    });
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    new RTCPeerConnection().addTrack(noCanvasTrack);

    expect(addTrackMock.mock.calls[0][0]).toBe(noCanvasTrack);
    expect(createdCanvasTracks).toHaveLength(0);
  });

  it("returns the source track from sender.track when the sender stores a canvas track", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    const sender = new RTCPeerConnection().addTrack(sourceTrack);

    expect(sender.track).toBe(sourceTrack);
  });

  it("stops the pipeline without stopping the source and stops canvas when the source ends", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    new RTCPeerConnection().addTrack(sourceTrack);
    const canvasTrack = createdCanvasTracks[0];

    canvasTrack.stop();

    expect(canvasTrack.stopMock).toHaveBeenCalledTimes(1);
    expect(sourceTrack.stop).not.toHaveBeenCalled();

    const endingSourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    new RTCPeerConnection().addTrack(endingSourceTrack);
    const endingCanvasTrack = createdCanvasTracks[1];
    endingSourceTrack.dispatchEnded();

    expect(endingCanvasTrack.stopMock).toHaveBeenCalledTimes(1);
    expect(endingSourceTrack.stop).not.toHaveBeenCalled();
  });

  it("forwards canvas track enabled changes to the source track", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    new RTCPeerConnection().addTrack(sourceTrack);
    createdCanvasTracks[0].enabled = false;

    expect(sourceTrack.enabled).toBe(false);
  });

  it("forwards canvas track content hints, settings, capabilities, constraints, and constraints", async () => {
    const sourceTrack = createFakeTrack(
      "video",
      { aspectRatio: 16 / 9, height: 360, width: 640 },
      "Camera",
    );
    sourceTrack.getCapabilities = vi.fn(() => ({ width: { max: 1920, min: 320 } }));
    sourceTrack.getConstraints = vi.fn(() => ({ width: 640 }));
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    new RTCPeerConnection().addTrack(sourceTrack);
    const canvasTrack = createdCanvasTracks[0];
    canvasTrack.contentHint = "motion";
    await canvasTrack.applyConstraints({ width: 1280 });

    expect(sourceTrack.contentHint).toBe("motion");
    expect(canvasTrack.contentHint).toBe("motion");
    expect(canvasTrack.getSettings()).toMatchObject({ height: 360, width: 640 });
    expect(canvasTrack.getCapabilities()).toEqual({ width: { max: 1920, min: 320 } });
    expect(canvasTrack.getConstraints()).toEqual({ width: 640 });
    expect(sourceTrack.applyConstraints).toHaveBeenCalledWith({ width: 1280 });
  });

  it("tags getDisplayMedia tracks and propagates tags to clones", async () => {
    const displayTrack = createFakeTrack("video", {}, "Captured source");
    getDisplayMedia.mockResolvedValue(createFakeStream([displayTrack]));
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    const stream = await navigator.mediaDevices.getDisplayMedia();
    const taggedTrack = stream.getVideoTracks()[0];
    const clone = taggedTrack.clone();
    const peerConnection = new RTCPeerConnection();
    peerConnection.addTrack(taggedTrack);
    peerConnection.addTrack(clone);

    expect(addTrackMock.mock.calls[0][0]).toBe(taggedTrack);
    expect(addTrackMock.mock.calls[1][0]).toBe(clone);
    expect(createdCanvasTracks).toHaveLength(0);
  });

  it("does not patch getUserMedia", () => {
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    expect(navigator.mediaDevices.getUserMedia).toBe(getUserMedia);
  });

  it("shows the local self-view overlay and hides it when disabled", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    new RTCPeerConnection().addTrack(sourceTrack);
    createVisibleSelfView(sourceTrack);

    postCameraBubbleMessage({ durationMs: 2_000, kind: "show", text: "発言中です" });

    const overlay = Array.from(document.querySelectorAll("div")).find(
      (element) => element.textContent === "発言中です",
    );
    expect(overlay).toBeDefined();
    expect(overlay?.style.display).toBe("block");
    expect(overlay?.style.right).not.toBe("16px");
    expect(overlay?.style.transform).toContain("scale(");
    expect(overlay?.style.boxShadow).toContain("4px");
    expect(overlay?.style.boxShadow).toContain("15px");

    postCameraBubbleMessage({ ...enabledConfig, enabled: false, kind: "config" });
    nextAnimationFrame();

    expect(overlay?.style.display).toBe("none");
  });

  it("hides a pending overlay frame after the bubble is cleared", () => {
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    postCameraBubbleMessage({ durationMs: 2_000, kind: "show", text: "clear pending" });
    const overlay = overlayWithText("clear pending");
    postCameraBubbleMessage({ ...enabledConfig, enabled: false, kind: "config" });
    nextAnimationFrame();

    expect(overlay?.style.display).toBe("none");
  });

  it("keeps a pinned bubble visible until a hide message arrives", () => {
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    postCameraBubbleMessage({ kind: "show", pinned: true, text: "stay pinned" });
    const overlay = overlayWithText("stay pinned");
    expect(overlay?.style.display).toBe("block");

    vi.advanceTimersByTime(60_000);
    nextAnimationFrame();
    nextAnimationFrame();

    expect(overlay?.style.display).toBe("block");

    postCameraBubbleMessage({ kind: "hide" });
    expect(overlay?.style.display).toBe("none");
  });

  it("keeps a pinned bubble from being replaced by temporary bubble text", () => {
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    postCameraBubbleMessage({ kind: "show", pinned: true, text: "pinned comment" });
    postCameraBubbleMessage({ durationMs: 2_000, kind: "show", text: "temporary comment" });

    expect(overlayWithText("pinned comment")?.style.display).toBe("block");
    expect(overlayWithText("temporary comment")).toBeUndefined();
  });

  it("draws active bubble text into the canvas pipeline", () => {
    vi.setSystemTime(1_000);
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    new RTCPeerConnection().addTrack(sourceTrack);

    postCameraBubbleMessage({ durationMs: 2_000, kind: "show", text: "canvas bubble" });
    nextAnimationFrame();

    expect(canvasContexts[0].drawImage).toHaveBeenCalled();
    expect(canvasContexts[0].beginPath).toHaveBeenCalled();
    expect(canvasContexts[0].fill).toHaveBeenCalled();
    expect(canvasContexts[0].fillText).toHaveBeenCalledWith(
      "canvas bubble",
      expect.any(Number),
      expect.any(Number),
    );
    expect(canvasContexts[0].restore).toHaveBeenCalled();
  });

  it("resizes the canvas when video metadata has different dimensions", () => {
    const sourceTrack = createFakeTrack("video", { height: 180, width: 320 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    new RTCPeerConnection().addTrack(sourceTrack);
    const canvasTrack = createdCanvasTracks[0];

    nextAnimationFrame();

    expect(canvasTrack.getSettings()).toMatchObject({ height: 360, width: 640 });
  });

  it("clears expired canvas bubbles during drawing", () => {
    vi.setSystemTime(1_000);
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    new RTCPeerConnection().addTrack(sourceTrack);

    postCameraBubbleMessage({ durationMs: 2_000, kind: "show", text: "expired canvas" });
    vi.setSystemTime(3_000);
    nextAnimationFrame();

    expect(canvasContexts[0].fillText).not.toHaveBeenCalledWith(
      "expired canvas",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("draws a black frame when the source track is disabled or muted", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    sourceTrack.enabled = false;
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    new RTCPeerConnection().addTrack(sourceTrack);

    nextAnimationFrame();

    expect(canvasContexts[0].fillRect).toHaveBeenCalledWith(0, 0, 640, 360);
    expect(canvasContexts[0].drawImage).not.toHaveBeenCalled();
  });

  it("uses requestVideoFrameCallback when the video element supports it", () => {
    const frameCallbacks: Array<(now: DOMHighResTimeStamp, metadata: unknown) => void> = [];
    const requestVideoFrameCallback = vi.fn(
      (callback: (now: DOMHighResTimeStamp, metadata: unknown) => void) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      },
    );
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: requestVideoFrameCallback,
    });
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    new RTCPeerConnection().addTrack(sourceTrack);
    postCameraBubbleMessage({ durationMs: 2_000, kind: "show", text: "video frame" });
    frameCallbacks.at(-1)?.(1_000, {});

    expect(canvasContexts[0].fillText).toHaveBeenCalledWith(
      "video frame",
      expect.any(Number),
      expect.any(Number),
    );
    expect(requestVideoFrameCallback).toHaveBeenCalled();
  });

  it("mirrors own textarea chat messages into the overlay without IPC", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    textArea.value = "  送信します\n";
    document.body.append(textArea);

    dispatchEnter(textArea);

    const overlay = overlayWithText("送信します");
    expect(overlay).toBeDefined();
    expect(overlay?.style.display).toBe("block");
    expect(overlay?.style.boxShadow).toContain("2px");
    expect(overlay?.style.boxShadow).toContain("10px");
  });

  it("mirrors own contenteditable chat messages into the overlay without IPC", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { configurable: true, value: true });
    const child = document.createElement("span");
    child.textContent = "contenteditable 送信";
    editable.append(child);
    document.body.append(editable);

    dispatchEnter(child);

    expect(overlayWithText("contenteditable 送信")).toBeDefined();
  });

  it("ignores hidden contenteditable descendants when mirroring own chat messages", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { configurable: true, value: true });
    const hidden = document.createElement("span");
    hidden.hidden = true;
    hidden.textContent = "hidden";
    const ariaHidden = document.createElement("span");
    ariaHidden.setAttribute("aria-hidden", "true");
    ariaHidden.textContent = "aria";
    editable.append("visible", hidden, ariaHidden);
    document.body.append(editable);

    dispatchEnter(editable);

    expect(overlayWithText("visible")).toBeDefined();
    expect(overlayWithText("visiblehiddenaria")).toBeUndefined();
  });

  it("mirrors own send-button chat clicks into the overlay", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    textArea.value = "クリックで送信";
    const sendButton = document.createElement("button");
    sendButton.type = "button";
    sendButton.setAttribute("aria-label", "Send a message");
    document.body.append(textArea, sendButton);

    dispatchInput(textArea);
    sendButton.click();

    expect(overlayWithText("クリックで送信")).toBeDefined();
  });

  it("mirrors own role-button chat clicks into the overlay", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    textArea.value = "role button 送信";
    const sendButton = document.createElement("div");
    sendButton.setAttribute("role", "button");
    sendButton.setAttribute("aria-label", "Send a message");
    document.body.append(textArea, sendButton);

    dispatchInput(textArea);
    sendButton.click();

    expect(overlayWithText("role button 送信")).toBeDefined();
  });

  it("falls back to send-button text when explicit labels are empty", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    textArea.value = "空ラベルの送信";
    const sendButton = document.createElement("button");
    sendButton.type = "button";
    sendButton.setAttribute("aria-label", "");
    sendButton.setAttribute("title", "");
    sendButton.textContent = "Send";
    document.body.append(textArea, sendButton);

    dispatchInput(textArea);
    sendButton.click();

    expect(overlayWithText("空ラベルの送信")).toBeDefined();
  });

  it("ignores stale send-button click chat input", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    textArea.value = "古い入力";
    const sendButton = document.createElement("button");
    sendButton.type = "button";
    sendButton.setAttribute("aria-label", "Send a message");
    document.body.append(textArea, sendButton);

    dispatchInput(textArea);
    vi.setSystemTime(2_001);
    sendButton.click();

    expect(overlayWithText("古い入力")).toBeUndefined();
  });

  it("refreshes stale focused chat input on a send-button click without mousedown", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    textArea.value = "キーボード送信";
    const sendButton = document.createElement("button");
    sendButton.type = "button";
    sendButton.setAttribute("aria-label", "Send a message");
    document.body.append(textArea, sendButton);
    textArea.focus();

    dispatchInput(textArea);
    vi.setSystemTime(2_001);
    sendButton.click();

    expect(overlayWithText("キーボード送信")).toBeDefined();
  });

  it("refreshes stale focused chat input before a send-button click", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    textArea.value = "フォーカス中の入力";
    const sendButton = document.createElement("button");
    sendButton.type = "button";
    sendButton.setAttribute("aria-label", "Send a message");
    document.body.append(textArea, sendButton);
    textArea.focus();

    dispatchInput(textArea);
    vi.setSystemTime(2_001);
    dispatchMouseDown(sendButton);
    sendButton.click();

    expect(overlayWithText("フォーカス中の入力")).toBeDefined();
  });

  it("does not mirror stale chat input when another empty editor sends", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const firstTextArea = document.createElement("textarea");
    firstTextArea.value = "別入力欄の古い投稿";
    const secondTextArea = document.createElement("textarea");
    secondTextArea.value = "";
    const sendButton = document.createElement("button");
    sendButton.type = "button";
    sendButton.setAttribute("aria-label", "Send a message");
    document.body.append(firstTextArea, secondTextArea, sendButton);

    dispatchInput(firstTextArea);
    secondTextArea.focus();
    dispatchMouseDown(sendButton);
    sendButton.click();

    expect(overlayWithText("別入力欄の古い投稿")).toBeUndefined();
  });

  it("ignores composing, disabled, empty, non-editable, and disabled-feature chat mirror events", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    textArea.value = "ignored";
    document.body.append(textArea);

    dispatchEnter(textArea, { keyCode: 229 });
    expect(overlayWithText("ignored")).toBeUndefined();

    textArea.value = "";
    dispatchEnter(textArea);
    expect(overlayWithText("ignored")).toBeUndefined();

    textArea.value = "disabled";
    textArea.disabled = true;
    dispatchEnter(textArea);
    expect(overlayWithText("disabled")).toBeUndefined();

    textArea.disabled = false;
    postCameraBubbleMessage({ ...enabledConfig, chatMirrorEnabled: false, kind: "config" });
    dispatchEnter(textArea);
    expect(overlayWithText("disabled")).toBeUndefined();

    postCameraBubbleMessage({ ...enabledConfig, enabled: false, kind: "config" });
    dispatchEnter(textArea);
    expect(overlayWithText("disabled")).toBeUndefined();

    const input = document.createElement("input");
    input.value = "input ignored";
    document.body.append(input);
    postCameraBubbleMessage({ ...enabledConfig, kind: "config" });
    dispatchEnter(input);
    expect(overlayWithText("input ignored")).toBeUndefined();
  });

  it("rate-limits mirrored chat messages locally", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    document.body.append(textArea);

    textArea.value = "first";
    dispatchEnter(textArea);
    textArea.value = "second";
    vi.setSystemTime(1_100);
    dispatchEnter(textArea);

    expect(overlayWithText("first")).toBeDefined();
    expect(overlayWithText("second")).toBeUndefined();

    vi.setSystemTime(1_300);
    dispatchEnter(textArea);
    nextAnimationFrame();

    expect(overlayWithText("second")).toBeDefined();
  });

  it("mirrors Meet chat toast notifications into the overlay", async () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const toast = document.createElement("div");
    toast.setAttribute("role", "status");

    document.body.append(toast);
    toast.textContent = "参加者からのコメント";
    await flushMutationObserver();

    const overlay = overlayWithText("参加者からのコメント");
    expect(overlay).toBeDefined();
    expect(overlay?.style.display).toBe("block");
  });

  it("mirrors updates inside existing Meet chat toast roots", async () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const toast = document.createElement("div");
    toast.setAttribute("aria-live", "polite");
    const text = document.createTextNode("");
    toast.append(text);
    document.body.append(toast);
    await flushMutationObserver();

    text.data = "後から入ったコメント";
    await flushMutationObserver();

    expect(overlayWithText("後から入ったコメント")).toBeDefined();
  });

  it("mirrors child elements appended inside existing Meet chat toast roots", async () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    document.body.append(toast);
    await flushMutationObserver();
    const child = document.createElement("span");
    child.textContent = "子要素のコメント";

    toast.append(child);
    await flushMutationObserver();

    expect(overlayWithText("子要素のコメント")).toBeDefined();
  });

  it("ignores Meet chat toast notifications when chat mirroring is disabled", async () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(
      { ...enabledConfig, chatMirrorEnabled: false },
      cameraBubbleDeps,
      expectedNonce,
    );
    const toast = document.createElement("div");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = "ignored toast";

    document.body.append(toast);
    await flushMutationObserver();

    expect(overlayWithText("ignored toast")).toBeUndefined();
  });

  it("deduplicates repeated Meet chat toast notifications", async () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const firstToast = document.createElement("div");
    firstToast.setAttribute("role", "status");
    firstToast.textContent = "dupe";
    document.body.append(firstToast);
    await flushMutationObserver();

    vi.setSystemTime(2_000);
    const duplicateToast = document.createElement("div");
    duplicateToast.setAttribute("role", "status");
    duplicateToast.textContent = "dupe";
    document.body.append(duplicateToast);
    await flushMutationObserver();

    vi.setSystemTime(4_101);
    nextAnimationFrame();

    expect(overlayWithText("dupe")?.style.display).toBe("none");
  });

  it("deduplicates own mirrored chat messages from Meet chat toast notifications", async () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    textArea.value = "dupe";
    const sendButton = document.createElement("button");
    sendButton.type = "button";
    sendButton.setAttribute("aria-label", "Send a message");
    document.body.append(textArea, sendButton);
    dispatchInput(textArea);
    sendButton.click();

    vi.setSystemTime(2_000);
    const duplicateToast = document.createElement("div");
    duplicateToast.setAttribute("role", "status");
    duplicateToast.textContent = "dupe";
    document.body.append(duplicateToast);
    await flushMutationObserver();

    vi.setSystemTime(4_101);
    nextAnimationFrame();

    expect(overlayWithText("dupe")?.style.display).toBe("none");
  });

  it("deduplicates rate-limited own chat messages from later Meet chat toast notifications", async () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    const sendButton = document.createElement("button");
    sendButton.type = "button";
    sendButton.setAttribute("aria-label", "Send a message");
    document.body.append(textArea, sendButton);

    textArea.value = "rate-limited first";
    dispatchInput(textArea);
    sendButton.click();
    textArea.value = "rate-limited second";
    dispatchInput(textArea);
    vi.setSystemTime(1_100);
    sendButton.click();

    vi.setSystemTime(2_000);
    const duplicateToast = document.createElement("div");
    duplicateToast.setAttribute("role", "status");
    duplicateToast.textContent = "rate-limited second";
    document.body.append(duplicateToast);
    await flushMutationObserver();

    expect(overlayWithText("rate-limited second")).toBeUndefined();
  });

  it("does not register duplicate Meet chat toast observers when installed twice", async () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.textContent = "single observer";

    document.body.append(toast);
    await flushMutationObserver();

    expect(overlaysWithText("single observer")).toHaveLength(1);
  });

  it("ignores chat mirror handler exceptions", () => {
    vi.setSystemTime(1_000);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const textArea = document.createElement("textarea");
    Object.defineProperty(textArea, "value", {
      configurable: true,
      get: () => {
        throw new Error("textarea unavailable");
      },
    });
    document.body.append(textArea);

    expect(() => dispatchEnter(textArea)).not.toThrow();
  });

  it("continues installing when the chat mirror listener cannot be registered", () => {
    const originalAddEventListener = document.addEventListener;
    Object.defineProperty(document, "addEventListener", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("listener denied");
      }),
    });

    try {
      expect(() =>
        installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce),
      ).not.toThrow();
    } finally {
      Object.defineProperty(document, "addEventListener", {
        configurable: true,
        value: originalAddEventListener,
      });
    }
  });

  it("falls back instead of anchoring to a weak non-pipeline video candidate", () => {
    const remoteTrack = createFakeTrack("video", { height: 360, width: 640 }, "Remote camera");
    const remoteVideo = document.createElement("video");
    remoteVideo.srcObject = createFakeStream([remoteTrack]);
    remoteVideo.playsInline = true;
    Object.defineProperty(remoteVideo, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          bottom: 380,
          height: 360,
          left: 20,
          right: 660,
          top: 20,
          width: 640,
          x: 20,
          y: 20,
        }) as DOMRect,
    });
    document.body.append(remoteVideo);
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);

    postCameraBubbleMessage({ durationMs: 2_000, kind: "show", text: "fallback" });

    const overlay = Array.from(document.querySelectorAll("div")).find(
      (element) => element.textContent === "fallback",
    );
    expect(overlay?.style.right).toBe("16px");
    expect(overlay?.style.transform).toContain("scale(");
  });

  it("does not anchor the overlay to a display-tagged video without displaySurface", async () => {
    const displayTrack = createFakeTrack("video", { height: 360, width: 640 }, "Captured source");
    getDisplayMedia.mockResolvedValue(createFakeStream([displayTrack]));
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    const displayStream = await navigator.mediaDevices.getDisplayMedia();
    createVisibleSelfView(displayStream.getVideoTracks()[0]);

    postCameraBubbleMessage({ durationMs: 2_000, kind: "show", text: "tagged display" });

    const overlay = Array.from(document.querySelectorAll("div")).find(
      (element) => element.textContent === "tagged display",
    );
    expect(overlay?.style.right).toBe("16px");
    expect(overlay?.style.transform).toContain("scale(");
  });

  it("hides the overlay when the canvas draw loop expires the shared bubble first", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(enabledConfig, cameraBubbleDeps, expectedNonce);
    new RTCPeerConnection().addTrack(sourceTrack);
    createVisibleSelfView(sourceTrack);

    postCameraBubbleMessage({ durationMs: 2_000, kind: "show", text: "expires" });
    const overlay = Array.from(document.querySelectorAll("div")).find(
      (element) => element.textContent === "expires",
    );

    vi.advanceTimersByTime(2_001);
    nextAnimationFrame();
    nextAnimationFrame();

    expect(overlay?.style.display).toBe("none");
  });
});

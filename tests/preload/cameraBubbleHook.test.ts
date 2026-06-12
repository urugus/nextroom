import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCameraBubbleHook } from "../../src/preload/cameraBubbleHook";
import {
  computeBubbleAlpha,
  computeBubbleLayout,
  computeCanvasSize,
  computeOverlayBox,
  hasVideoConstraints,
  isDisplayCaptureLike,
  parseCameraBubbleEnvelope,
  scoreSelfViewCandidate,
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
  computeBubbleAlpha,
  computeBubbleLayout,
  computeOverlayBox,
  computeCanvasSize,
  hasVideoConstraints,
  isDisplayCaptureLike,
  parseCameraBubbleEnvelope,
  scoreSelfViewCandidate,
  wrapBubbleLines,
};
const expectedNonce = "hook-nonce";

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
      | { durationMs: number; kind: "show"; text: string }
      | { enabled: boolean; kind: "setEnabled" },
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

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    senderTrackState.tracks = new WeakMap();
    animationCallbacks.length = 0;
    createdCanvasTracks = [];

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
      value: vi.fn(() => ({
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
      })),
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

    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);
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
    postCameraBubbleMessage({ enabled: false, kind: "setEnabled" });
    disabledPeerConnection.addTrack(disabledCameraTrack);

    expect(addTrackMock.mock.calls.at(-1)?.[0]).toBe(disabledCameraTrack);
  });

  it("reuses wrapped tracks on replaceTrack and passes through null and canvas tracks", async () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);

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
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);

    new RTCPeerConnection().addTransceiver(sourceTrack, init);

    expect(addTransceiverMock.mock.calls[0][0]).toBe(createdCanvasTracks[0]);
    expect(addTransceiverMock.mock.calls[0][1]).toBe(init);
  });

  it("passes through string kind, display tracks, and disabled feature on addTransceiver", async () => {
    const displayTrack = createFakeTrack("video", {}, "Captured source");
    const disabledTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    getDisplayMedia.mockResolvedValue(createFakeStream([displayTrack]));
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);
    const displayStream = await navigator.mediaDevices.getDisplayMedia();
    const peerConnection = new RTCPeerConnection();

    peerConnection.addTransceiver("video");
    peerConnection.addTransceiver(displayStream.getVideoTracks()[0]);
    postCameraBubbleMessage({ enabled: false, kind: "setEnabled" });
    peerConnection.addTransceiver(disabledTrack);

    expect(addTransceiverMock.mock.calls[0][0]).toBe("video");
    expect(addTransceiverMock.mock.calls[1][0]).toBe(displayTrack);
    expect(addTransceiverMock.mock.calls[2][0]).toBe(disabledTrack);
    expect(createdCanvasTracks).toHaveLength(0);
  });

  it("reuses the same pipeline across addTrack and addTransceiver", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);
    const peerConnection = new RTCPeerConnection();

    peerConnection.addTrack(sourceTrack);
    peerConnection.addTransceiver(sourceTrack);

    expect(addTrackMock.mock.calls[0][0]).toBe(createdCanvasTracks[0]);
    expect(addTransceiverMock.mock.calls[0][0]).toBe(createdCanvasTracks[0]);
    expect(createdCanvasTracks).toHaveLength(1);
  });

  it("returns the source track from sender.track when the sender stores a canvas track", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);

    const sender = new RTCPeerConnection().addTrack(sourceTrack);

    expect(sender.track).toBe(sourceTrack);
  });

  it("stops the pipeline without stopping the source and stops canvas when the source ends", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);

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
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);

    new RTCPeerConnection().addTrack(sourceTrack);
    createdCanvasTracks[0].enabled = false;

    expect(sourceTrack.enabled).toBe(false);
  });

  it("tags getDisplayMedia tracks and propagates tags to clones", async () => {
    const displayTrack = createFakeTrack("video", {}, "Captured source");
    getDisplayMedia.mockResolvedValue(createFakeStream([displayTrack]));
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);

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
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);

    expect(navigator.mediaDevices.getUserMedia).toBe(getUserMedia);
  });

  it("shows the local self-view overlay and hides it when disabled", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);
    new RTCPeerConnection().addTrack(sourceTrack);
    createVisibleSelfView(sourceTrack);

    postCameraBubbleMessage({ durationMs: 2_000, kind: "show", text: "発言中です" });

    const overlay = Array.from(document.querySelectorAll("div")).find(
      (element) => element.textContent === "発言中です",
    );
    expect(overlay).toBeDefined();
    expect(overlay?.style.display).toBe("block");
    expect(overlay?.style.right).not.toBe("16px");

    postCameraBubbleMessage({ enabled: false, kind: "setEnabled" });
    nextAnimationFrame();

    expect(overlay?.style.display).toBe("none");
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
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);

    postCameraBubbleMessage({ durationMs: 2_000, kind: "show", text: "fallback" });

    const overlay = Array.from(document.querySelectorAll("div")).find(
      (element) => element.textContent === "fallback",
    );
    expect(overlay?.style.right).toBe("16px");
  });

  it("hides the overlay when the canvas draw loop expires the shared bubble first", () => {
    const sourceTrack = createFakeTrack("video", { height: 360, width: 640 }, "Camera");
    installCameraBubbleHook(true, cameraBubbleDeps, expectedNonce);
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCameraBubbleHook } from "../../src/preload/cameraBubbleHook";
import {
  computeBubbleAlpha,
  computeBubbleLayout,
  computeCanvasSize,
  hasVideoConstraints,
  parseCameraBubbleEnvelope,
  wrapBubbleLines,
} from "../../src/preload/cameraBubblePure";

type FakeMediaStreamTrack = MediaStreamTrack & {
  dispatchEnded: () => void;
  stop: ReturnType<typeof vi.fn>;
};

type FakeMediaStream = MediaStream & {
  tracks: MediaStreamTrack[];
};

type MediaStreamConstructor = new (tracks?: MediaStreamTrack[]) => MediaStream;

const cameraBubbleDeps = {
  computeBubbleAlpha,
  computeBubbleLayout,
  computeCanvasSize,
  hasVideoConstraints,
  parseCameraBubbleEnvelope,
  wrapBubbleLines,
};

const createFakeTrack = (
  kind: "audio" | "video",
  settings: MediaTrackSettings = {},
): FakeMediaStreamTrack => {
  const target = new EventTarget();
  const track = {
    addEventListener: target.addEventListener.bind(target),
    applyConstraints: vi.fn(() => Promise.resolve()),
    clone: vi.fn(),
    contentHint: "",
    dispatchEnded: () => {
      target.dispatchEvent(new Event("ended"));
    },
    dispatchEvent: target.dispatchEvent.bind(target),
    enabled: true,
    getCapabilities: vi.fn(() => ({})),
    getConstraints: vi.fn(() => ({})),
    getSettings: vi.fn(() => settings),
    id: `${kind}-track`,
    kind,
    label: `${kind} track`,
    muted: false,
    onended: null,
    onmute: null,
    onunmute: null,
    readyState: "live" as MediaStreamTrackState,
    removeEventListener: target.removeEventListener.bind(target),
    stop: vi.fn(),
  };

  return track as unknown as FakeMediaStreamTrack;
};

const createFakeMediaStream = (tracks: MediaStreamTrack[] = []): FakeMediaStream => {
  const stream = {
    active: true,
    addEventListener: vi.fn(),
    addTrack: vi.fn(),
    clone: vi.fn(),
    dispatchEvent: vi.fn(),
    getAudioTracks: vi.fn(() => tracks.filter((track) => track.kind === "audio")),
    getTrackById: vi.fn((id: string) => tracks.find((track) => track.id === id) ?? null),
    getTracks: vi.fn(() => tracks),
    getVideoTracks: vi.fn(() => tracks.filter((track) => track.kind === "video")),
    onaddtrack: null,
    onremovetrack: null,
    removeEventListener: vi.fn(),
    removeTrack: vi.fn(),
    tracks,
  };

  return stream as unknown as FakeMediaStream;
};

describe("installCameraBubbleHook", () => {
  let canvasTrack: FakeMediaStreamTrack;
  let context: CanvasRenderingContext2D;
  let originalMediaStream: typeof globalThis.MediaStream | undefined;
  let rafCallback: FrameRequestCallback | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalMediaStream = globalThis.MediaStream;
    canvasTrack = createFakeTrack("video", { height: 720, width: 1280 });
    context = {
      beginPath: vi.fn(),
      closePath: vi.fn(),
      drawImage: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      lineTo: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const FakeMediaStream = new Proxy(Object, {
      construct: (_target, args) =>
        createFakeMediaStream((args[0] as MediaStreamTrack[] | undefined) ?? []),
    }) as unknown as MediaStreamConstructor;

    Object.defineProperty(globalThis, "MediaStream", {
      configurable: true,
      value: FakeMediaStream,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => context),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => createFakeMediaStream([canvasTrack])),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(),
      },
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        rafCallback = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    if (originalMediaStream === undefined) {
      Reflect.deleteProperty(globalThis, "MediaStream");
    } else {
      Object.defineProperty(globalThis, "MediaStream", {
        configurable: true,
        value: originalMediaStream,
      });
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("passes through when disabled", async () => {
    const stream = createFakeMediaStream([createFakeTrack("video")]);
    const constraints: MediaStreamConstraints = { video: true };
    const getUserMedia = vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);

    installCameraBubbleHook(false, cameraBubbleDeps);

    const result = await navigator.mediaDevices.getUserMedia(constraints);

    expect(getUserMedia).toHaveBeenCalledWith(constraints);
    expect(result).toBe(stream);
  });

  it("passes through audio-only constraints", async () => {
    const stream = createFakeMediaStream([createFakeTrack("audio")]);
    const constraints: MediaStreamConstraints = { audio: true };
    const getUserMedia = vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);

    installCameraBubbleHook(true, cameraBubbleDeps);

    const result = await navigator.mediaDevices.getUserMedia(constraints);

    expect(getUserMedia).toHaveBeenCalledWith(constraints);
    expect(result).toBe(stream);
  });

  it("returns the canvas video track and preserves audio tracks", async () => {
    const sourceTrack = createFakeTrack("video", { deviceId: "camera-1", height: 360, width: 640 });
    const audioTrack = createFakeTrack("audio");
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      createFakeMediaStream([sourceTrack, audioTrack]),
    );

    installCameraBubbleHook(true, cameraBubbleDeps);

    const result = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

    expect(result.getVideoTracks()).toEqual([canvasTrack]);
    expect(result.getAudioTracks()).toEqual([audioTrack]);
  });

  it("delegates facade settings to the source track and keeps canvas size", async () => {
    const sourceTrack = createFakeTrack("video", { deviceId: "camera-1", height: 360, width: 640 });
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      createFakeMediaStream([sourceTrack]),
    );

    installCameraBubbleHook(true, cameraBubbleDeps);

    const result = await navigator.mediaDevices.getUserMedia({ video: true });

    expect(result.getVideoTracks()[0].getSettings()).toMatchObject({
      deviceId: "camera-1",
      height: 360,
      width: 640,
    });
    expect(sourceTrack.getSettings).toHaveBeenCalled();
  });

  it("stops both the canvas track and source track from the facade stop", async () => {
    const sourceTrack = createFakeTrack("video");
    const originalCanvasStop = canvasTrack.stop;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      createFakeMediaStream([sourceTrack]),
    );

    installCameraBubbleHook(true, cameraBubbleDeps);

    const result = await navigator.mediaDevices.getUserMedia({ video: true });
    result.getVideoTracks()[0].stop();

    expect(originalCanvasStop).toHaveBeenCalledTimes(1);
    expect(sourceTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("ignores message events without the expected same-window envelope", async () => {
    const sourceTrack = createFakeTrack("video");
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      createFakeMediaStream([sourceTrack]),
    );
    installCameraBubbleHook(true, cameraBubbleDeps);
    await navigator.mediaDevices.getUserMedia({ video: true });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { __nextroomCameraBubble: { kind: "show", text: "ignored" } },
      }),
    );
    rafCallback?.(0);

    expect(context.fillText).not.toHaveBeenCalled();
  });

  it("draws shown bubble text until it expires", async () => {
    const sourceTrack = createFakeTrack("video");
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      createFakeMediaStream([sourceTrack]),
    );
    installCameraBubbleHook(true, cameraBubbleDeps);
    await navigator.mediaDevices.getUserMedia({ video: true });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { __nextroomCameraBubble: { kind: "show", text: "発言中です" } },
        source: window,
      }),
    );
    rafCallback?.(0);
    expect(context.fillText).toHaveBeenCalledWith(
      "発言中です",
      expect.any(Number),
      expect.any(Number),
    );

    vi.mocked(context.fillText).mockClear();
    vi.advanceTimersByTime(7_001);
    rafCallback?.(0);

    expect(context.fillText).not.toHaveBeenCalled();
  });
});

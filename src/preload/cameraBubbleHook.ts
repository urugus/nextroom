import type { CameraBubbleDeps } from "./cameraBubblePure";

// oxlint-disable unicorn/consistent-function-scoping -- The hook is injected with toString(), so helpers must stay inside it.
export const installCameraBubbleHook = (
  initialConfig: {
    chatMirrorEnabled: boolean;
    displaySpeedLevel: number;
    enabled: boolean;
    screenShareDanmakuEnabled: boolean;
  },
  deps: CameraBubbleDeps,
  nonce: string,
): void => {
  type VideoFrameRequestCallback = (now: DOMHighResTimeStamp, metadata: unknown) => void;
  type VideoWithFrameCallback = HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
  };
  type PatchRecord<T> = { original: T };
  type Pipeline = {
    canvas: HTMLCanvasElement;
    canvasTrack: MediaStreamTrack;
    mode: "camera" | "screenShare";
    sourceTrack: MediaStreamTrack;
    stop: () => void;
    video: HTMLVideoElement;
  };
  type OverlayState = {
    element: HTMLDivElement | undefined;
    frameId: number | undefined;
  };

  const state: {
    bubble:
      | { expiresAt: number | undefined; pinned: boolean; startedAt: number; text: string }
      | undefined;
    chatMirrorEnabled: boolean;
    danmakuMessages: Array<{
      durationMs: number;
      sequence: number;
      startedAt: number;
      text: string;
    }>;
    danmakuSequence: number;
    displaySpeedLevel: number;
    enabled: boolean;
    screenShareDanmakuEnabled: boolean;
  } = {
    bubble: undefined,
    chatMirrorEnabled: initialConfig.chatMirrorEnabled === true,
    danmakuMessages: [],
    danmakuSequence: 0,
    displaySpeedLevel:
      typeof initialConfig.displaySpeedLevel === "number" &&
      Number.isFinite(initialConfig.displaySpeedLevel)
        ? Math.max(1, Math.min(5, Math.floor(initialConfig.displaySpeedLevel)))
        : 3,
    enabled: initialConfig.enabled === true,
    screenShareDanmakuEnabled: initialConfig.screenShareDanmakuEnabled === true,
  };
  const overlayState: OverlayState = { element: undefined, frameId: undefined };
  const chatMirrorRateLimit = { lastAcceptedAt: 0 };
  const recentChatInput: {
    element: Element | undefined;
    text: string | undefined;
    updatedAt: number;
  } = {
    element: undefined,
    text: undefined,
    updatedAt: 0,
  };
  const chatToastMirrorState: {
    observer: MutationObserver | undefined;
    recentMessages: Array<{ acceptedAt: number; text: string }>;
  } = {
    observer: undefined,
    recentMessages: [],
  };
  const activePipelines = new Set<Pipeline>();
  const activeDisplaySenders = new Set<RTCRtpSender>();
  const displaySenderSources = new WeakMap<RTCRtpSender, MediaStreamTrack>();
  const displaySenderCleanupSources = new WeakSet<MediaStreamTrack>();
  const sourceToPipeline = new WeakMap<MediaStreamTrack, Pipeline>();
  const canvasToPipeline = new WeakMap<MediaStreamTrack, Pipeline>();
  const displayTracks = new WeakSet<MediaStreamTrack>();
  const addTrackPatchKey = Symbol.for("nextroom.cameraBubble.addTrack");
  const addTransceiverPatchKey = Symbol.for("nextroom.cameraBubble.addTransceiver");
  const replaceTrackPatchKey = Symbol.for("nextroom.cameraBubble.replaceTrack");
  const senderTrackPatchKey = Symbol.for("nextroom.cameraBubble.senderTrack");
  const clonePatchKey = Symbol.for("nextroom.cameraBubble.clone");
  const getDisplayMediaPatchKey = Symbol.for("nextroom.cameraBubble.getDisplayMedia");
  const chatToastObserverPatchKey = Symbol.for("nextroom.cameraBubble.chatToastObserver");

  const readPatchRecord = <T>(target: object, key: symbol): PatchRecord<T> | undefined => {
    const value = Reflect.get(target, key);
    return typeof value === "object" && value !== null && "original" in value
      ? (value as PatchRecord<T>)
      : undefined;
  };

  const writePatchRecord = <T>(target: object, key: symbol, original: T): void => {
    Object.defineProperty(target, key, {
      configurable: true,
      value: { original },
    });
  };

  const isMediaStreamTrack = (value: unknown): value is MediaStreamTrack =>
    typeof MediaStreamTrack !== "undefined" && value instanceof MediaStreamTrack;

  const isMediaStream = (value: unknown): value is MediaStream =>
    typeof MediaStream !== "undefined" && value instanceof MediaStream;

  const resizeCanvasToTrackSettings = (
    canvas: HTMLCanvasElement,
    track: MediaStreamTrack,
  ): void => {
    const size = deps.computeCanvasSize(track.getSettings());
    canvas.width = size.width;
    canvas.height = size.height;
  };

  const resizeCanvasToVideo = (canvas: HTMLCanvasElement, video: HTMLVideoElement): void => {
    if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
    if (canvas.width === video.videoWidth && canvas.height === video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  };

  const roundedRect = (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void => {
    const boundedRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + boundedRadius, y);
    context.lineTo(x + width - boundedRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + boundedRadius);
    context.lineTo(x + width, y + height - boundedRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - boundedRadius, y + height);
    context.lineTo(x + boundedRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - boundedRadius);
    context.lineTo(x, y + boundedRadius);
    context.quadraticCurveTo(x, y, x + boundedRadius, y);
    context.closePath();
  };

  const drawBubble = (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void => {
    const currentBubble = state.bubble;
    if (currentBubble === undefined) return;

    const now = Date.now();
    const animation = deps.computeBubbleAnimation({
      enterDurationMs: 260,
      expiresAt: currentBubble.expiresAt,
      fadeDurationMs: 500,
      now,
      startedAt: currentBubble.startedAt,
    });
    if (currentBubble.expiresAt !== undefined && now >= currentBubble.expiresAt) {
      state.bubble = undefined;
      hideOverlay();
      return;
    }

    const initialLayout = deps.computeBubbleLayout({
      canvasHeight: canvas.height,
      canvasWidth: canvas.width,
      lineCount: 1,
      maxLineWidth: 0,
    });
    context.save();
    context.font = `${initialLayout.fontSize}px sans-serif`;
    context.textBaseline = "top";
    const measure = (text: string): number => context.measureText(text).width;
    const lines = deps.wrapBubbleLines(measure, currentBubble.text, initialLayout.textMaxWidth, 3);
    const measuredWidth = Math.max(
      ...lines.map((line) => context.measureText(line).width),
      initialLayout.fontSize,
    );
    const layout = deps.computeBubbleLayout({
      canvasHeight: canvas.height,
      canvasWidth: canvas.width,
      lineCount: lines.length,
      maxLineWidth: measuredWidth,
    });

    context.globalAlpha = animation.opacity;
    context.translate(
      layout.x + layout.width / 2,
      layout.y + layout.height / 2 + animation.translateY,
    );
    context.scale(animation.scale, animation.scale);
    const bubbleX = -layout.width / 2;
    const bubbleY = -layout.height / 2;
    roundedRect(context, bubbleX, bubbleY, layout.width, layout.height, layout.radius);
    context.fillStyle = "rgba(255,255,255,0.92)";
    context.shadowColor = "rgba(0,0,0,0.35)";
    context.shadowBlur = layout.shadowBlur;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = layout.shadowOffsetY;
    context.fill();
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = "#202124";
    lines.forEach((line, index) => {
      context.fillText(
        line,
        bubbleX + layout.padding,
        bubbleY + layout.padding + layout.lineHeight * index,
      );
    });
    context.restore();
  };

  const drawDanmaku = (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void => {
    if (!state.enabled || !state.screenShareDanmakuEnabled) return;

    const now = Date.now();
    state.danmakuMessages = state.danmakuMessages.filter(
      (message) => now - message.startedAt < message.durationMs,
    );
    if (state.danmakuMessages.length === 0) return;

    const style = deps.computeDanmakuTextStyle({ canvasHeight: canvas.height });
    const laneCount = Math.max(1, Math.floor(canvas.height / style.lineHeight));
    context.save();
    context.font = `700 ${style.fontSize}px sans-serif`;
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    context.strokeStyle = "rgba(0,0,0,0.72)";
    context.lineWidth = style.strokeWidth;
    context.shadowColor = "rgba(0,0,0,0.55)";
    context.shadowBlur = Math.round(style.fontSize * 0.18);
    context.shadowOffsetX = 0;
    context.shadowOffsetY = Math.max(1, Math.round(style.fontSize * 0.08));

    state.danmakuMessages.forEach((message) => {
      const textWidth = context.measureText(message.text).width;
      const position = deps.computeDanmakuPosition({
        canvasWidth: canvas.width,
        durationMs: message.durationMs,
        elapsedMs: now - message.startedAt,
        lane: deps.computeDanmakuLane({ laneCount, sequence: message.sequence }),
        lineHeight: style.lineHeight,
        textWidth,
      });
      context.globalAlpha = position.alpha;
      context.strokeText(message.text, position.x, position.y);
      context.fillText(message.text, position.x, position.y);
    });
    context.restore();
  };

  const schedulePipelineDraw = (
    video: VideoWithFrameCallback,
    lifecycle: { stopped: boolean },
    draw: () => void,
  ): void => {
    if (lifecycle.stopped) return;

    if (video.requestVideoFrameCallback !== undefined) {
      video.requestVideoFrameCallback(() => draw());
      return;
    }

    window.requestAnimationFrame(() => draw());
  };

  const buildPipeline = (
    sourceTrack: MediaStreamTrack,
    mode: "camera" | "screenShare",
  ): MediaStreamTrack => {
    const existing = sourceToPipeline.get(sourceTrack);
    if (existing !== undefined) return existing.canvasTrack;

    const video = document.createElement("video") as VideoWithFrameCallback;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) return sourceTrack;
    if (typeof canvas.captureStream !== "function") return sourceTrack;

    resizeCanvasToTrackSettings(canvas, sourceTrack);
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([sourceTrack]);
    video.addEventListener("loadedmetadata", () => resizeCanvasToVideo(canvas, video));
    void video.play().catch(() => undefined);

    const canvasStream = canvas.captureStream(30);
    const canvasTrack = canvasStream.getVideoTracks()[0];
    if (canvasTrack === undefined) return sourceTrack;

    const lifecycle = { stopped: false };
    const originalCanvasTrackStop = canvasTrack.stop.bind(canvasTrack);
    const originalGetSettings = sourceTrack.getSettings.bind(sourceTrack);
    const originalGetCapabilities = sourceTrack.getCapabilities?.bind(sourceTrack);
    const originalGetConstraints = sourceTrack.getConstraints.bind(sourceTrack);
    const originalApplyConstraints = sourceTrack.applyConstraints.bind(sourceTrack);
    const stopPipeline = (): void => {
      if (lifecycle.stopped) return;

      lifecycle.stopped = true;
      activePipelines.delete(pipeline);
      sourceToPipeline.delete(sourceTrack);
      canvasToPipeline.delete(canvasTrack);
      originalCanvasTrackStop();
      video.srcObject = null;
    };
    const pipeline: Pipeline = {
      canvas,
      canvasTrack,
      mode,
      sourceTrack,
      stop: stopPipeline,
      video,
    };
    const draw = (): void => {
      if (lifecycle.stopped) return;

      resizeCanvasToVideo(canvas, video);
      if (sourceTrack.enabled === false || sourceTrack.muted) {
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.width, canvas.height);
      } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (pipeline.mode === "screenShare") {
          drawDanmaku(context, canvas);
        } else {
          drawBubble(context, canvas);
        }
      }

      schedulePipelineDraw(video, lifecycle, draw);
    };

    sourceTrack.addEventListener("ended", stopPipeline, { once: true });
    canvasTrack.getSettings = () => ({
      ...originalGetSettings(),
      height: canvas.height,
      width: canvas.width,
    });
    canvasTrack.getCapabilities = () =>
      originalGetCapabilities === undefined ? {} : originalGetCapabilities();
    canvasTrack.getConstraints = () => originalGetConstraints();
    canvasTrack.applyConstraints = (constraints) =>
      originalApplyConstraints(constraints).then(() => {
        resizeCanvasToTrackSettings(canvas, sourceTrack);
      });
    canvasTrack.stop = stopPipeline;
    Object.defineProperty(canvasTrack, "enabled", {
      configurable: true,
      get: () => sourceTrack.enabled,
      set: (value: boolean) => {
        sourceTrack.enabled = value;
      },
    });
    Object.defineProperty(canvasTrack, "contentHint", {
      configurable: true,
      get: () => sourceTrack.contentHint,
      set: (value: string) => {
        sourceTrack.contentHint = value;
      },
    });

    sourceToPipeline.set(sourceTrack, pipeline);
    canvasToPipeline.set(canvasTrack, pipeline);
    activePipelines.add(pipeline);
    draw();

    return canvasTrack;
  };

  const isDisplayCaptureTrack = (track: MediaStreamTrack): boolean =>
    displayTracks.has(track) || deps.isDisplayCaptureLike(track.getSettings());

  const cleanupDisplaySendersFor = (sourceTrack: MediaStreamTrack): void => {
    activeDisplaySenders.forEach((sender) => {
      if (displaySenderSources.get(sender) !== sourceTrack) return;

      activeDisplaySenders.delete(sender);
      displaySenderSources.delete(sender);
    });
  };

  const rememberSenderTrack = (sender: unknown, track: unknown): void => {
    if (typeof RTCRtpSender === "undefined" || !(sender instanceof RTCRtpSender)) return;

    const sourceTrack = isMediaStreamTrack(track)
      ? (canvasToPipeline.get(track)?.sourceTrack ?? track)
      : undefined;
    if (
      sourceTrack !== undefined &&
      sourceTrack.kind === "video" &&
      isDisplayCaptureTrack(sourceTrack)
    ) {
      activeDisplaySenders.add(sender);
      displaySenderSources.set(sender, sourceTrack);
      if (!displaySenderCleanupSources.has(sourceTrack)) {
        displaySenderCleanupSources.add(sourceTrack);
        sourceTrack.addEventListener("ended", () => cleanupDisplaySendersFor(sourceTrack), {
          once: true,
        });
      }
      return;
    }

    activeDisplaySenders.delete(sender);
    displaySenderSources.delete(sender);
  };

  const wrapTrackForSender = (track: unknown): unknown => {
    if (!isMediaStreamTrack(track)) return track;
    if (track.kind !== "video") return track;
    if (!state.enabled) return track;
    if (canvasToPipeline.has(track)) return track;
    if (isDisplayCaptureTrack(track)) {
      return state.screenShareDanmakuEnabled ? buildPipeline(track, "screenShare") : track;
    }

    return buildPipeline(track, "camera");
  };

  const syncDisplaySenders = (): void => {
    activeDisplaySenders.forEach((sender) => {
      const sourceTrack = displaySenderSources.get(sender);
      if (sourceTrack === undefined || sourceTrack.readyState !== "live") {
        activeDisplaySenders.delete(sender);
        displaySenderSources.delete(sender);
        return;
      }

      const nextTrack = wrapTrackForSender(sourceTrack);
      if (!isMediaStreamTrack(nextTrack)) return;

      const pipelineToStop = sourceToPipeline.get(sourceTrack);
      void sender
        .replaceTrack(nextTrack)
        .then(() => {
          if (nextTrack === sourceTrack && pipelineToStop?.mode === "screenShare") {
            pipelineToStop.stop();
          }
        })
        .catch(() => undefined);
    });
  };

  const tagDisplayStream = (stream: MediaStream): void => {
    stream.getVideoTracks().forEach((track) => {
      displayTracks.add(track);
    });
  };

  const installGetDisplayMediaPatch = (): void => {
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.getDisplayMedia === undefined) return;
    if (
      readPatchRecord<typeof mediaDevices.getDisplayMedia>(mediaDevices, getDisplayMediaPatchKey)
    ) {
      return;
    }

    const originalGetDisplayMedia = mediaDevices.getDisplayMedia.bind(mediaDevices);
    const wrappedGetDisplayMedia: typeof mediaDevices.getDisplayMedia = async (constraints) => {
      const stream = await originalGetDisplayMedia(constraints);
      tagDisplayStream(stream);
      return stream;
    };
    writePatchRecord(mediaDevices, getDisplayMediaPatchKey, mediaDevices.getDisplayMedia);
    Object.defineProperty(mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: wrappedGetDisplayMedia,
    });
  };

  const installClonePatch = (): void => {
    if (typeof MediaStreamTrack === "undefined") return;
    const prototype = MediaStreamTrack.prototype;
    if (readPatchRecord<MediaStreamTrack["clone"]>(prototype, clonePatchKey)) return;

    const originalClone = prototype.clone;
    const wrappedClone = new Proxy(originalClone, {
      apply: (target, thisArgument, argumentList) => {
        const cloned = Reflect.apply(target, thisArgument, argumentList);
        if (isMediaStreamTrack(thisArgument) && isMediaStreamTrack(cloned)) {
          if (displayTracks.has(thisArgument)) displayTracks.add(cloned);
        }
        return cloned;
      },
    }) as MediaStreamTrack["clone"];

    writePatchRecord(prototype, clonePatchKey, originalClone);
    Object.defineProperty(prototype, "clone", {
      configurable: true,
      value: wrappedClone,
    });
  };

  const installAddTrackPatch = (): void => {
    if (typeof RTCPeerConnection === "undefined") return;
    const prototype = RTCPeerConnection.prototype;
    if (readPatchRecord<RTCPeerConnection["addTrack"]>(prototype, addTrackPatchKey)) return;

    const originalAddTrack = prototype.addTrack;
    const wrappedAddTrack = new Proxy(originalAddTrack, {
      apply: (target, thisArgument, argumentList) => {
        const [track, ...streams] = argumentList;
        const wrappedTrack = wrapTrackForSender(track);
        const sender = Reflect.apply(target, thisArgument, [wrappedTrack, ...streams]);
        rememberSenderTrack(sender, track);
        return sender;
      },
    }) as RTCPeerConnection["addTrack"];

    writePatchRecord(prototype, addTrackPatchKey, originalAddTrack);
    Object.defineProperty(prototype, "addTrack", {
      configurable: true,
      value: wrappedAddTrack,
    });
  };

  const installAddTransceiverPatch = (): void => {
    if (typeof RTCPeerConnection === "undefined") return;
    const prototype = RTCPeerConnection.prototype;
    if (readPatchRecord<RTCPeerConnection["addTransceiver"]>(prototype, addTransceiverPatchKey)) {
      return;
    }

    const originalAddTransceiver = prototype.addTransceiver;
    const wrappedAddTransceiver = new Proxy(originalAddTransceiver, {
      apply: (target, thisArgument, argumentList) => {
        const [trackOrKind, ...rest] = argumentList;
        const wrappedTrackOrKind =
          typeof trackOrKind === "string" ? trackOrKind : wrapTrackForSender(trackOrKind);
        const transceiver = Reflect.apply(target, thisArgument, [wrappedTrackOrKind, ...rest]);
        if (typeof trackOrKind !== "string") {
          rememberSenderTrack(transceiver.sender, trackOrKind);
        }
        return transceiver;
      },
    }) as RTCPeerConnection["addTransceiver"];

    writePatchRecord(prototype, addTransceiverPatchKey, originalAddTransceiver);
    Object.defineProperty(prototype, "addTransceiver", {
      configurable: true,
      value: wrappedAddTransceiver,
    });
  };

  const installReplaceTrackPatch = (): void => {
    if (typeof RTCRtpSender === "undefined") return;
    const prototype = RTCRtpSender.prototype;
    if (readPatchRecord<RTCRtpSender["replaceTrack"]>(prototype, replaceTrackPatchKey)) return;

    const originalReplaceTrack = prototype.replaceTrack;
    const wrappedReplaceTrack = new Proxy(originalReplaceTrack, {
      apply: (target, thisArgument, argumentList) => {
        const wrappedTrack = wrapTrackForSender(argumentList[0]);
        const result = Reflect.apply(target, thisArgument, [wrappedTrack]);
        rememberSenderTrack(thisArgument, argumentList[0]);
        return result;
      },
    }) as RTCRtpSender["replaceTrack"];

    writePatchRecord(prototype, replaceTrackPatchKey, originalReplaceTrack);
    Object.defineProperty(prototype, "replaceTrack", {
      configurable: true,
      value: wrappedReplaceTrack,
    });
  };

  const installSenderTrackGetterPatch = (): void => {
    if (typeof RTCRtpSender === "undefined") return;
    const prototype = RTCRtpSender.prototype;
    if (readPatchRecord<PropertyDescriptor>(prototype, senderTrackPatchKey)) return;

    const descriptor = Object.getOwnPropertyDescriptor(prototype, "track");
    if (descriptor?.get === undefined) return;

    const originalGetter = descriptor.get as (this: RTCRtpSender) => MediaStreamTrack | null;
    const wrappedGetter = new Proxy(originalGetter, {
      apply: (target, thisArgument, argumentList) => {
        const track = Reflect.apply(target, thisArgument, argumentList);
        return isMediaStreamTrack(track)
          ? (canvasToPipeline.get(track)?.sourceTrack ?? track)
          : track;
      },
    }) as () => MediaStreamTrack | null;

    writePatchRecord(prototype, senderTrackPatchKey, descriptor);
    Object.defineProperty(prototype, "track", {
      ...descriptor,
      get: wrappedGetter,
    });
  };

  const liveVideoTrackFor = (video: HTMLVideoElement): MediaStreamTrack | undefined => {
    const source = video.srcObject;
    if (!isMediaStream(source)) return undefined;

    return source.getVideoTracks().find((track) => track.readyState === "live");
  };

  const visibleRect = (rect: DOMRect): boolean =>
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.top < window.innerHeight;

  const aspectDeltaFor = (
    rect: DOMRect,
    video: HTMLVideoElement,
    track: MediaStreamTrack,
  ): number => {
    const settings = track.getSettings();
    const sourceWidth =
      typeof settings.width === "number" && settings.width > 0 ? settings.width : video.videoWidth;
    const sourceHeight =
      typeof settings.height === "number" && settings.height > 0
        ? settings.height
        : video.videoHeight;
    if (sourceWidth <= 0 || sourceHeight <= 0 || rect.height <= 0) return 1;

    const sourceAspect = sourceWidth / sourceHeight;
    const rectAspect = rect.width / rect.height;
    return Math.abs(rectAspect - sourceAspect) / sourceAspect;
  };

  const selfViewCandidateFor = (
    video: HTMLVideoElement,
  ): { rect: DOMRect; score: number } | undefined => {
    const track = liveVideoTrackFor(video);
    if (track === undefined) return undefined;

    const rect = video.getBoundingClientRect();
    const isPipelineSource = sourceToPipeline.has(track);
    const isDisplayCapture = isDisplayCaptureTrack(track);
    const score = deps.scoreSelfViewCandidate({
      aspectDelta: aspectDeltaFor(rect, video, track),
      isDisplayCapture,
      isPipelineSource,
      muted: video.muted,
      playsInline: video.playsInline,
      visible: visibleRect(rect),
    });
    const accepted =
      (isPipelineSource && score >= 4) ||
      (!isDisplayCapture && video.muted && video.playsInline && score >= 6);

    return accepted ? { rect, score } : undefined;
  };

  const bestSelfViewCandidate = (): { rect: DOMRect; score: number } | undefined =>
    Array.from(document.querySelectorAll("video"))
      .map((video) => selfViewCandidateFor(video))
      .filter((candidate): candidate is { rect: DOMRect; score: number } => candidate !== undefined)
      .reduce<{ rect: DOMRect; score: number } | undefined>(
        (best, candidate) =>
          best === undefined || candidate.score > best.score ? candidate : best,
        undefined,
      );

  const ensureOverlayElement = (): HTMLDivElement => {
    if (overlayState.element !== undefined) return overlayState.element;

    const element = document.createElement("div");
    element.style.position = "fixed";
    element.style.pointerEvents = "none";
    element.style.zIndex = "2147483646";
    element.style.backgroundColor = "rgba(255,255,255,0.9)";
    element.style.backdropFilter = "blur(18px)";
    element.style.color = "#202124";
    element.style.fontFamily = "sans-serif";
    element.style.lineHeight = "1.25";
    element.style.boxSizing = "border-box";
    element.style.overflowWrap = "anywhere";
    element.style.transition = "opacity 120ms ease-out, transform 120ms ease-out";
    element.style.transformOrigin = "right center";
    element.style.willChange = "opacity, transform";
    element.style.display = "none";
    document.documentElement.append(element);
    overlayState.element = element;
    return element;
  };

  const hideOverlay = (): void => {
    if (overlayState.frameId !== undefined) {
      window.cancelAnimationFrame(overlayState.frameId);
      overlayState.frameId = undefined;
    }
    if (overlayState.element !== undefined) {
      overlayState.element.style.display = "none";
      overlayState.element.style.opacity = "0";
    }
  };

  const positionOverlay = (element: HTMLDivElement, now: number): void => {
    const currentBubble = state.bubble;
    if (currentBubble === undefined) {
      hideOverlay();
      return;
    }

    const animation = deps.computeBubbleAnimation({
      enterDurationMs: 260,
      expiresAt: currentBubble.expiresAt,
      fadeDurationMs: 500,
      now,
      startedAt: currentBubble.startedAt,
    });
    if (currentBubble.expiresAt !== undefined && now >= currentBubble.expiresAt) {
      state.bubble = undefined;
      hideOverlay();
      return;
    }

    const candidate = bestSelfViewCandidate();
    element.textContent = currentBubble.text;
    element.style.display = "block";
    element.style.opacity = String(animation.opacity);

    if (candidate === undefined) {
      element.style.left = "";
      element.style.right = "16px";
      element.style.top = "";
      element.style.bottom = "16px";
      element.style.transform = `translateY(${animation.translateY}px) scale(${animation.scale})`;
      element.style.maxWidth = "min(60vw, 360px)";
      element.style.fontSize = "16px";
      element.style.padding = "8px 10px";
      element.style.borderRadius = "9px";
      element.style.boxShadow = "0 2px 10px rgba(0,0,0,0.35)";
      return;
    }

    const box = deps.computeOverlayBox({
      rectHeight: candidate.rect.height,
      rectLeft: candidate.rect.left,
      rectTop: candidate.rect.top,
      rectWidth: candidate.rect.width,
    });
    element.style.left = "";
    element.style.right = `${Math.max(0, window.innerWidth - box.right)}px`;
    element.style.top = `${box.top}px`;
    element.style.bottom = "";
    element.style.transform = `translateY(calc(-50% + ${animation.translateY}px)) scale(${animation.scale})`;
    element.style.maxWidth = `${box.maxWidth}px`;
    element.style.fontSize = `${box.fontSize}px`;
    element.style.padding = `${Math.round(box.fontSize * 0.5)}px ${Math.round(
      box.fontSize * 0.65,
    )}px`;
    element.style.borderRadius = `${Math.round(box.fontSize * 0.55)}px`;
    element.style.boxShadow = `0 ${box.shadowOffsetY}px ${box.shadowBlur}px rgba(0,0,0,0.35)`;
  };

  const runOverlayLoop = (): void => {
    const element = ensureOverlayElement();
    positionOverlay(element, Date.now());
    if (state.bubble === undefined) return;

    overlayState.frameId = window.requestAnimationFrame(() => runOverlayLoop());
  };

  const showOverlay = (): void => {
    if (overlayState.frameId !== undefined) return;

    runOverlayLoop();
  };

  const shouldCollectChatText = (): boolean =>
    state.enabled && (state.chatMirrorEnabled || state.screenShareDanmakuEnabled);

  const addDanmakuMessage = (text: string, durationMs: number | undefined): void => {
    if (!state.enabled || !state.screenShareDanmakuEnabled) return;

    const now = Date.now();
    state.danmakuMessages = state.danmakuMessages.filter(
      (message) => now - message.startedAt < message.durationMs,
    );
    const sequence = state.danmakuSequence;
    state.danmakuSequence += 1;
    state.danmakuMessages.push({
      durationMs:
        durationMs ??
        deps.computeBubbleDisplayDurationMs([...text].length, state.displaySpeedLevel),
      sequence,
      startedAt: now,
      text,
    });
  };

  const showCameraBubble = (
    text: string,
    durationMs: number | undefined,
    pinned: boolean,
  ): void => {
    if (state.bubble?.pinned === true && !pinned) {
      return;
    }

    const now = Date.now();
    state.bubble = {
      expiresAt: pinned || durationMs === undefined ? undefined : now + durationMs,
      pinned,
      startedAt: now,
      text,
    };
    showOverlay();
  };

  const showBubble = (text: string, durationMs: number | undefined, pinned: boolean): void => {
    // Pinned camera bubbles should not hide transient screen-share comments.
    addDanmakuMessage(text, durationMs);
    showCameraBubble(text, durationMs, pinned);
  };

  const showMirroredChatText = (text: string, durationMs: number): void => {
    addDanmakuMessage(text, durationMs);
    if (state.chatMirrorEnabled) {
      showCameraBubble(text, durationMs, false);
    }
  };

  const isEditableElement = (element: Element): boolean => {
    if (element instanceof HTMLInputElement) return true;
    if (element instanceof HTMLTextAreaElement) return true;
    if (element instanceof HTMLSelectElement) return true;
    if (element instanceof HTMLElement && element.isContentEditable) return true;

    return false;
  };

  const hasEditableAncestor = (element: Element): boolean => {
    let current: Element | null = element;
    while (current !== null) {
      if (isEditableElement(current)) return true;
      current = current.parentElement;
    }

    return false;
  };

  const isLikelyChatToastRoot = (element: Element): boolean => {
    const role = element.getAttribute("role")?.toLowerCase();
    const ariaLive = element.getAttribute("aria-live")?.toLowerCase();
    return (
      role === "status" ||
      role === "alert" ||
      role === "log" ||
      ariaLive === "polite" ||
      ariaLive === "assertive"
    );
  };

  const closestChatToastRoot = (element: Element): Element | undefined => {
    let current: Element | null = element;
    while (current !== null) {
      if (isLikelyChatToastRoot(current)) return current;
      current = current.parentElement;
    }

    return undefined;
  };

  const chatToastRootsIn = (element: Element): Element[] => {
    const roots: Element[] = [];
    if (isLikelyChatToastRoot(element)) {
      roots.push(element);
    }
    element
      .querySelectorAll('[role="status"], [role="alert"], [role="log"], [aria-live]')
      .forEach((candidate) => {
        if (isLikelyChatToastRoot(candidate)) {
          roots.push(candidate);
        }
      });

    return roots;
  };

  const textContentForChatToast = (element: Element): string => {
    const textContent = element.textContent ?? "";
    if (textContent.trim().length > 0) return textContent;

    const innerText =
      element instanceof HTMLElement && typeof element.innerText === "string"
        ? element.innerText
        : undefined;

    return innerText ?? "";
  };

  const acceptChatToastText = (text: string, now: number): boolean => {
    chatToastMirrorState.recentMessages = chatToastMirrorState.recentMessages.filter(
      (message) => now - message.acceptedAt < 10_000,
    );
    if (chatToastMirrorState.recentMessages.some((message) => message.text === text)) {
      return false;
    }

    chatToastMirrorState.recentMessages.push({ acceptedAt: now, text });
    return true;
  };

  const mirrorChatToastElement = (element: Element): void => {
    try {
      if (!shouldCollectChatText()) return;
      if (overlayState.element?.contains(element)) return;
      if (hasEditableAncestor(element)) return;

      const rawText = textContentForChatToast(element);
      if (rawText.trim().length < 2 || rawText.length > 280) return;

      const text = deps.sanitizeBubbleText(rawText);
      if (text.length === 0) return;

      const now = Date.now();
      if (!acceptChatToastText(text, now)) return;

      showMirroredChatText(
        text,
        deps.computeBubbleDisplayDurationMs([...text].length, state.displaySpeedLevel),
      );
    } catch {
      return;
    }
  };

  const scanChatToastNode = (node: Node): void => {
    try {
      if (node instanceof CharacterData && node.parentElement !== null) {
        const root = closestChatToastRoot(node.parentElement);
        if (root !== undefined) {
          mirrorChatToastElement(root);
        }
        return;
      }
      if (!(node instanceof Element)) return;
      chatToastRootsIn(node).forEach(mirrorChatToastElement);
    } catch {
      return;
    }
  };

  const installChatToastMirrorObserver = (): void => {
    try {
      if (typeof MutationObserver === "undefined") return;
      if (chatToastMirrorState.observer !== undefined) return;
      if (readPatchRecord<MutationObserver>(window, chatToastObserverPatchKey)) return;

      const target = document.body ?? document.documentElement;
      if (target === null) return;

      const observer = new MutationObserver((records) => {
        try {
          records.forEach((record) => {
            if (
              record.type === "characterData" ||
              (record.target instanceof Element &&
                closestChatToastRoot(record.target) !== undefined)
            ) {
              scanChatToastNode(record.target);
            }
            record.addedNodes.forEach(scanChatToastNode);
          });
        } catch {
          return;
        }
      });
      observer.observe(target, { characterData: true, childList: true, subtree: true });
      writePatchRecord(window, chatToastObserverPatchKey, observer);
      chatToastMirrorState.observer = observer;
    } catch {
      return;
    }
  };

  const editableChatElementFor = (target: EventTarget | null): Element | undefined => {
    if (!(target instanceof Element)) return undefined;
    if (target instanceof HTMLTextAreaElement) return target;

    let current: Element | null = target;
    while (current !== null && current !== document.body && current !== document.documentElement) {
      if (current instanceof HTMLElement && current.isContentEditable) return current;
      current = current.parentElement;
    }

    return undefined;
  };

  const isHiddenFromEditableText = (element: Element): boolean => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.hidden) return true;
    if (element.getAttribute("aria-hidden") === "true") return true;

    const style = window.getComputedStyle(element);
    return style.display === "none" || style.visibility === "hidden";
  };

  const visibleTextForContentEditable = (element: HTMLElement): string => {
    let text = "";
    const appendText = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? "";
        return;
      }
      if (!(node instanceof Element)) return;
      if (node !== element && isHiddenFromEditableText(node)) return;

      node.childNodes.forEach(appendText);
    };

    appendText(element);
    return text;
  };

  const textForEditableChatElement = (element: Element): string | undefined => {
    if (element instanceof HTMLTextAreaElement) return element.value;
    if (!(element instanceof HTMLElement) || !element.isContentEditable) return undefined;

    return visibleTextForContentEditable(element);
  };

  const chatEditableFor = (
    target: EventTarget | null,
  ): { disabled: boolean; element: Element; readOnly: boolean; text: string } | undefined => {
    const element = editableChatElementFor(target);
    if (element === undefined) return undefined;

    const text = textForEditableChatElement(element);
    if (text === undefined) return undefined;

    return {
      disabled: element instanceof HTMLTextAreaElement && element.disabled,
      element,
      readOnly: element instanceof HTMLTextAreaElement && element.readOnly,
      text,
    };
  };

  const rememberChatInput = (target: EventTarget | null): void => {
    const editable = chatEditableFor(target);
    if (editable === undefined) return;

    const text = deps.sanitizeBubbleText(editable.text);
    if (text.length === 0) {
      recentChatInput.element = editable.element;
      recentChatInput.text = undefined;
      recentChatInput.updatedAt = Date.now();
      return;
    }

    recentChatInput.element = editable.element;
    recentChatInput.text = text;
    recentChatInput.updatedAt = Date.now();
  };

  const mirrorOwnChatText = (text: string): boolean => {
    const sanitizedText = deps.sanitizeBubbleText(text);
    if (sanitizedText.length === 0) return false;

    const now = Date.now();
    acceptChatToastText(sanitizedText, now);
    if (now - chatMirrorRateLimit.lastAcceptedAt < 300) return false;

    chatMirrorRateLimit.lastAcceptedAt = now;
    showMirroredChatText(
      sanitizedText,
      deps.computeBubbleDisplayDurationMs([...sanitizedText].length, state.displaySpeedLevel),
    );
    return true;
  };

  const isLikelyChatSendClickTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;

    const button = target.closest('button, [role="button"]');
    if (button === null) return false;

    const explicitLabel = [button.getAttribute("aria-label"), button.getAttribute("title")]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ");
    const label = (
      explicitLabel.length > 0 ? explicitLabel : (button.textContent ?? "")
    ).toLowerCase();

    return /\b(send|post)\b|送信|投稿/.test(label);
  };

  const installChatMirrorListener = (): void => {
    try {
      document.addEventListener(
        "input",
        (event) => {
          try {
            if (!shouldCollectChatText()) return;

            rememberChatInput(event.target);
          } catch {
            return;
          }
        },
        { capture: true },
      );
      document.addEventListener(
        "keydown",
        (event) => {
          try {
            if (!shouldCollectChatText()) return;

            const editable = chatEditableFor(event.target);
            if (editable !== undefined) {
              rememberChatInput(editable.element);
            }
            const acceptedKey = deps.shouldMirrorChatKey({
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              disabled: editable?.disabled === true,
              isComposing: event.isComposing,
              isEditable: editable !== undefined,
              key: event.key,
              keyCode: event.keyCode,
              metaKey: event.metaKey,
              readOnly: editable?.readOnly === true,
              shiftKey: event.shiftKey,
            });
            if (!acceptedKey || editable === undefined) return;

            mirrorOwnChatText(editable.text);
          } catch {
            return;
          }
        },
        { capture: true },
      );
      document.addEventListener(
        "mousedown",
        (event) => {
          try {
            if (!shouldCollectChatText()) return;
            if (!isLikelyChatSendClickTarget(event.target)) return;

            rememberChatInput(document.activeElement);
          } catch {
            return;
          }
        },
        { capture: true },
      );
      document.addEventListener(
        "click",
        (event) => {
          try {
            if (!shouldCollectChatText()) return;
            if (!isLikelyChatSendClickTarget(event.target)) return;
            if (
              recentChatInput.text === undefined ||
              Date.now() - recentChatInput.updatedAt > 1_000
            ) {
              rememberChatInput(document.activeElement);
            }
            if (recentChatInput.text === undefined) return;
            if (Date.now() - recentChatInput.updatedAt > 1_000) return;

            const text = recentChatInput.text;
            recentChatInput.text = undefined;
            mirrorOwnChatText(text);
          } catch {
            return;
          }
        },
        { capture: true },
      );
    } catch {
      return;
    }
  };

  installGetDisplayMediaPatch();
  installClonePatch();
  installAddTrackPatch();
  installAddTransceiverPatch();
  installReplaceTrackPatch();
  installSenderTrackGetterPatch();
  installChatMirrorListener();
  installChatToastMirrorObserver();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = deps.parseCameraBubbleEnvelope(event.data, nonce);
    if (message === undefined) return;

    if (message.kind === "show") {
      if (!state.enabled) return;

      showBubble(message.text, message.durationMs, message.pinned);
      return;
    }

    if (message.kind === "hide") {
      state.bubble = undefined;
      hideOverlay();
      return;
    }

    if (message.kind === "config") {
      const previousEnabled = state.enabled;
      const previousScreenShareDanmakuEnabled = state.screenShareDanmakuEnabled;
      state.enabled = message.enabled === true;
      state.chatMirrorEnabled = message.chatMirrorEnabled === true;
      state.displaySpeedLevel = message.displaySpeedLevel;
      state.screenShareDanmakuEnabled = message.screenShareDanmakuEnabled === true;
      if (!state.enabled) {
        state.bubble = undefined;
        state.danmakuMessages = [];
        hideOverlay();
      }
      if (!state.screenShareDanmakuEnabled) {
        state.danmakuMessages = [];
      }
      if (
        previousEnabled !== state.enabled ||
        previousScreenShareDanmakuEnabled !== state.screenShareDanmakuEnabled
      ) {
        syncDisplaySenders();
      }
    }
  });
};

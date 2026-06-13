import type { CameraBubbleDeps } from "./cameraBubblePure";

// oxlint-disable unicorn/consistent-function-scoping -- The hook is injected with toString(), so helpers must stay inside it.
export const installCameraBubbleHook = (
  initialConfig: { chatMirrorEnabled: boolean; displaySpeedLevel: number; enabled: boolean },
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
    sourceTrack: MediaStreamTrack;
    stop: () => void;
    video: HTMLVideoElement;
  };
  type OverlayState = {
    element: HTMLDivElement | undefined;
    frameId: number | undefined;
  };

  const state: {
    bubble: { expiresAt: number; text: string } | undefined;
    chatMirrorEnabled: boolean;
    displaySpeedLevel: number;
    enabled: boolean;
  } = {
    bubble: undefined,
    chatMirrorEnabled: initialConfig.chatMirrorEnabled === true,
    displaySpeedLevel:
      typeof initialConfig.displaySpeedLevel === "number" &&
      Number.isFinite(initialConfig.displaySpeedLevel)
        ? Math.max(1, Math.min(5, Math.floor(initialConfig.displaySpeedLevel)))
        : 3,
    enabled: initialConfig.enabled === true,
  };
  const overlayState: OverlayState = { element: undefined, frameId: undefined };
  const chatMirrorRateLimit = { lastAcceptedAt: 0 };
  const activePipelines = new Set<Pipeline>();
  const sourceToPipeline = new WeakMap<MediaStreamTrack, Pipeline>();
  const canvasToPipeline = new WeakMap<MediaStreamTrack, Pipeline>();
  const displayTracks = new WeakSet<MediaStreamTrack>();
  const addTrackPatchKey = Symbol.for("nextroom.cameraBubble.addTrack");
  const addTransceiverPatchKey = Symbol.for("nextroom.cameraBubble.addTransceiver");
  const replaceTrackPatchKey = Symbol.for("nextroom.cameraBubble.replaceTrack");
  const senderTrackPatchKey = Symbol.for("nextroom.cameraBubble.senderTrack");
  const clonePatchKey = Symbol.for("nextroom.cameraBubble.clone");
  const getDisplayMediaPatchKey = Symbol.for("nextroom.cameraBubble.getDisplayMedia");

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
    const alpha = deps.computeBubbleAlpha(now, currentBubble.expiresAt, 500);
    if (alpha === 0) {
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

    context.globalAlpha = alpha;
    roundedRect(context, layout.x, layout.y, layout.width, layout.height, layout.radius);
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
        layout.x + layout.padding,
        layout.y + layout.padding + layout.lineHeight * index,
      );
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

  const buildPipeline = (sourceTrack: MediaStreamTrack): MediaStreamTrack => {
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
        drawBubble(context, canvas);
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

  const wrapTrackForSender = (track: unknown): unknown => {
    if (!isMediaStreamTrack(track)) return track;
    if (track.kind !== "video") return track;
    if (!state.enabled) return track;
    if (canvasToPipeline.has(track)) return track;
    if (isDisplayCaptureTrack(track)) return track;

    return buildPipeline(track);
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
        return Reflect.apply(target, thisArgument, [wrapTrackForSender(track), ...streams]);
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
        return Reflect.apply(target, thisArgument, [wrappedTrackOrKind, ...rest]);
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
      apply: (target, thisArgument, argumentList) =>
        Reflect.apply(target, thisArgument, [wrapTrackForSender(argumentList[0])]),
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
    element.style.backgroundColor = "rgba(255,255,255,0.92)";
    element.style.color = "#202124";
    element.style.fontFamily = "sans-serif";
    element.style.lineHeight = "1.25";
    element.style.boxSizing = "border-box";
    element.style.overflowWrap = "anywhere";
    element.style.transition = "opacity 500ms linear";
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

    const alpha = deps.computeBubbleAlpha(now, currentBubble.expiresAt, 500);
    if (alpha === 0) {
      state.bubble = undefined;
      hideOverlay();
      return;
    }

    const candidate = bestSelfViewCandidate();
    element.textContent = currentBubble.text;
    element.style.display = "block";
    element.style.opacity = String(alpha);

    if (candidate === undefined) {
      element.style.left = "";
      element.style.right = "16px";
      element.style.top = "";
      element.style.bottom = "16px";
      element.style.transform = "";
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
    element.style.transform = "translateY(-50%)";
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

  const showBubble = (text: string, durationMs: number): void => {
    state.bubble = { expiresAt: Date.now() + durationMs, text };
    showOverlay();
  };

  const installChatMirrorListener = (): void => {
    try {
      document.addEventListener(
        "keydown",
        (event) => {
          try {
            if (!state.enabled || !state.chatMirrorEnabled) return;

            const target = event.target;
            const isTextArea =
              typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement;
            const textArea = isTextArea ? target : undefined;
            const acceptedKey = deps.shouldMirrorChatKey({
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              disabled: textArea?.disabled === true,
              isComposing: event.isComposing,
              isTextArea,
              key: event.key,
              keyCode: event.keyCode,
              metaKey: event.metaKey,
              readOnly: textArea?.readOnly === true,
              shiftKey: event.shiftKey,
            });
            if (!acceptedKey || textArea === undefined) return;

            const text = deps.sanitizeBubbleText(textArea.value);
            if (text.length === 0) return;

            const now = Date.now();
            if (now - chatMirrorRateLimit.lastAcceptedAt < 300) return;

            chatMirrorRateLimit.lastAcceptedAt = now;
            showBubble(
              text,
              deps.computeBubbleDisplayDurationMs([...text].length, state.displaySpeedLevel),
            );
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

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = deps.parseCameraBubbleEnvelope(event.data, nonce);
    if (message === undefined) return;

    if (message.kind === "show") {
      if (!state.enabled) return;

      showBubble(message.text, message.durationMs);
      return;
    }

    if (message.kind === "config") {
      state.enabled = message.enabled === true;
      state.chatMirrorEnabled = message.chatMirrorEnabled === true;
      state.displaySpeedLevel = message.displaySpeedLevel;
      if (!state.enabled) {
        state.bubble = undefined;
        hideOverlay();
      }
    }
  });
};

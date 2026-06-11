import type { CameraBubbleDeps } from "./cameraBubblePure";

// oxlint-disable unicorn/consistent-function-scoping -- The hook is injected with toString(), so helpers must stay inside it.
export const installCameraBubbleHook = (
  initialEnabled: boolean,
  deps: CameraBubbleDeps,
  nonce: string,
): void => {
  type VideoFrameRequestCallback = (now: DOMHighResTimeStamp, metadata: unknown) => void;
  type VideoWithFrameCallback = HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
  };
  type Pipeline = {
    canvasTrack: MediaStreamTrack;
    sourceTrack: MediaStreamTrack;
    video: HTMLVideoElement;
  };
  const state: {
    bubble: { expiresAt: number; text: string } | undefined;
    enabled: boolean;
  } = { bubble: undefined, enabled: initialEnabled };
  const activePipelines = new Set<Pipeline>();
  const mediaDevices = navigator.mediaDevices;
  const originalGetUserMedia = mediaDevices?.getUserMedia?.bind(mediaDevices);

  if (originalGetUserMedia === undefined) {
    return;
  }

  const resizeCanvas = (canvas: HTMLCanvasElement, track: MediaStreamTrack): void => {
    const size = deps.computeCanvasSize(track.getSettings());
    canvas.width = size.width;
    canvas.height = size.height;
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
    context.fill();
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

  const buildPipeline = (stream: MediaStream, sourceTrack: MediaStreamTrack): MediaStream => {
    const video = document.createElement("video") as VideoWithFrameCallback;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) return stream;

    resizeCanvas(canvas, sourceTrack);
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([sourceTrack]);
    void video.play().catch(() => undefined);

    const canvasStream = canvas.captureStream(30);
    const canvasTrack = canvasStream.getVideoTracks()[0];
    if (canvasTrack === undefined) return stream;

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
      originalCanvasTrackStop();
      sourceTrack.stop();
      video.srcObject = null;
    };

    const pipeline: Pipeline = {
      canvasTrack,
      sourceTrack,
      video,
    };

    const draw = (): void => {
      if (lifecycle.stopped) return;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawBubble(context, canvas);
      }

      if (video.requestVideoFrameCallback !== undefined) {
        video.requestVideoFrameCallback(() => draw());
      } else {
        window.requestAnimationFrame(() => draw());
      }
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
        resizeCanvas(canvas, sourceTrack);
      });
    canvasTrack.stop = stopPipeline;

    activePipelines.add(pipeline);
    draw();

    return new MediaStream([canvasTrack, ...stream.getAudioTracks()]);
  };

  const wrappedGetUserMedia: typeof navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (!state.enabled || !deps.hasVideoConstraints(constraints)) {
      return originalGetUserMedia(constraints);
    }

    const stream = await originalGetUserMedia(constraints);
    const sourceTrack = stream.getVideoTracks()[0];
    if (sourceTrack === undefined) return stream;

    return buildPipeline(stream, sourceTrack);
  };

  mediaDevices.getUserMedia = wrappedGetUserMedia;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = deps.parseCameraBubbleEnvelope(event.data, nonce);
    if (message === undefined) return;

    if (message.kind === "show") {
      if (!state.enabled) return;

      state.bubble = { expiresAt: Date.now() + message.durationMs, text: message.text };
      return;
    }

    if (message.kind === "setEnabled") {
      state.enabled = message.enabled === true;
      if (!state.enabled) {
        state.bubble = undefined;
      }
    }
  });
};

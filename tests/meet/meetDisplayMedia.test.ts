import {
  type CapturableScreenShareSource,
  configureMeetDisplayMediaHandler,
  handleMeetDisplayMediaRequest,
  type ScreenAccessStatus,
} from "@main/meet/meetDisplayMedia";
import type { Session } from "electron";
import { describe, expect, it, vi } from "vitest";

type DisplayMediaRequest = Parameters<typeof handleMeetDisplayMediaRequest>[0];
type DisplayMediaRequestHandler = NonNullable<
  Parameters<Session["setDisplayMediaRequestHandler"]>[0]
>;

const createImage = (dataUrl: string, empty = false) => ({
  isEmpty: () => empty,
  toDataURL: () => dataUrl,
});

const screenSource: CapturableScreenShareSource = {
  appIcon: null,
  id: "screen:1:0",
  name: "Entire Screen",
  thumbnail: createImage("data:image/png;base64,screen"),
};

const windowSource: CapturableScreenShareSource = {
  appIcon: createImage("data:image/png;base64,icon"),
  id: "window:12:0",
  name: "Notes",
  thumbnail: createImage("data:image/png;base64,window"),
};

const windowSourceWithoutIcon: CapturableScreenShareSource = {
  appIcon: createImage("data:image/png;base64,empty-icon", true),
  id: "window:13:0",
  name: "Empty icon",
  thumbnail: createImage("data:image/png;base64,empty-window"),
};

const createRequest = (overrides: Partial<DisplayMediaRequest> = {}): DisplayMediaRequest => ({
  audioRequested: false,
  frame: null,
  securityOrigin: "https://meet.google.com",
  userGesture: true,
  videoRequested: true,
  ...overrides,
});

const createInput = (
  overrides: Partial<Parameters<typeof handleMeetDisplayMediaRequest>[1]> = {},
): Parameters<typeof handleMeetDisplayMediaRequest>[1] => ({
  chooseSource: vi.fn(async (sources) => sources[0]),
  getScreenAccessStatus: vi.fn((): ScreenAccessStatus => "granted"),
  getSources: vi.fn(async () => [screenSource, windowSource]),
  notifyScreenAccessDenied: vi.fn(),
  ...overrides,
});

describe("handleMeetDisplayMediaRequest", () => {
  it("returns the selected video source for Google Meet display media requests", async () => {
    const input = createInput({
      chooseSource: vi.fn(async (sources) => sources[1]),
    });

    const result = await handleMeetDisplayMediaRequest(createRequest(), input);

    expect(input.chooseSource).toHaveBeenCalledWith([
      {
        appIconDataUrl: undefined,
        id: "screen:1:0",
        kind: "screen",
        name: "Entire Screen",
        thumbnailDataUrl: "data:image/png;base64,screen",
      },
      {
        appIconDataUrl: "data:image/png;base64,icon",
        id: "window:12:0",
        kind: "window",
        name: "Notes",
        thumbnailDataUrl: "data:image/png;base64,window",
      },
    ]);
    expect(result).toEqual({
      video: {
        id: "window:12:0",
        name: "Notes",
      },
    });
  });

  it("omits empty app icons from window sources", async () => {
    const input = createInput({
      getSources: vi.fn(async () => [windowSourceWithoutIcon]),
    });

    await handleMeetDisplayMediaRequest(createRequest(), input);

    expect(input.chooseSource).toHaveBeenCalledWith([
      {
        appIconDataUrl: undefined,
        id: "window:13:0",
        kind: "window",
        name: "Empty icon",
        thumbnailDataUrl: "data:image/png;base64,empty-window",
      },
    ]);
  });

  it("ignores audio requests and returns only video", async () => {
    const result = await handleMeetDisplayMediaRequest(
      createRequest({ audioRequested: true }),
      createInput(),
    );

    expect(result).toEqual({
      video: {
        id: "screen:1:0",
        name: "Entire Screen",
      },
    });
  });

  it("denies requests outside Google Meet", async () => {
    const input = createInput();

    const result = await handleMeetDisplayMediaRequest(
      createRequest({ securityOrigin: "https://accounts.google.com" }),
      input,
    );

    expect(result).toEqual({});
    expect(input.getSources).not.toHaveBeenCalled();
  });

  it("denies requests without video or user gesture", async () => {
    const input = createInput();

    await expect(
      handleMeetDisplayMediaRequest(createRequest({ videoRequested: false }), input),
    ).resolves.toEqual({});
    await expect(
      handleMeetDisplayMediaRequest(createRequest({ userGesture: false }), input),
    ).resolves.toEqual({});
    expect(input.getSources).not.toHaveBeenCalled();
  });

  it("denies requests when screen access is denied or restricted", async () => {
    const notifyScreenAccessDenied = vi.fn();
    const deniedInput = createInput({
      getScreenAccessStatus: vi.fn((): ScreenAccessStatus => "denied"),
      notifyScreenAccessDenied,
    });
    const restrictedInput = createInput({
      getScreenAccessStatus: vi.fn((): ScreenAccessStatus => "restricted"),
      notifyScreenAccessDenied,
    });

    await expect(handleMeetDisplayMediaRequest(createRequest(), deniedInput)).resolves.toEqual({});
    await expect(handleMeetDisplayMediaRequest(createRequest(), restrictedInput)).resolves.toEqual(
      {},
    );

    expect(notifyScreenAccessDenied).toHaveBeenCalledTimes(2);
    expect(deniedInput.getSources).not.toHaveBeenCalled();
    expect(restrictedInput.getSources).not.toHaveBeenCalled();
  });

  it("denies restricted access when no notification callback is provided", async () => {
    const input = createInput({
      getScreenAccessStatus: vi.fn((): ScreenAccessStatus => "restricted"),
      notifyScreenAccessDenied: undefined,
    });

    await expect(handleMeetDisplayMediaRequest(createRequest(), input)).resolves.toEqual({});
  });

  it("denies requests when source listing fails or is empty", async () => {
    await expect(
      handleMeetDisplayMediaRequest(
        createRequest(),
        createInput({ getSources: vi.fn(async () => []) }),
      ),
    ).resolves.toEqual({});
    await expect(
      handleMeetDisplayMediaRequest(
        createRequest(),
        createInput({
          getSources: vi.fn(async () => {
            throw new Error("unavailable");
          }),
        }),
      ),
    ).resolves.toEqual({});
  });

  it("denies requests when the picker is cancelled or returns an unknown source", async () => {
    await expect(
      handleMeetDisplayMediaRequest(
        createRequest(),
        createInput({ chooseSource: vi.fn(async () => undefined) }),
      ),
    ).resolves.toEqual({});
    await expect(
      handleMeetDisplayMediaRequest(
        createRequest(),
        createInput({
          chooseSource: vi.fn(async () => ({
            id: "missing",
            kind: "window" as const,
            name: "Missing",
            thumbnailDataUrl: "data:image/png;base64,missing",
          })),
        }),
      ),
    ).resolves.toEqual({});
  });
});

describe("configureMeetDisplayMediaHandler", () => {
  it("registers the display media handler with the system picker preferred", async () => {
    let registeredHandler: DisplayMediaRequestHandler | undefined;
    const meetSession = {
      setDisplayMediaRequestHandler: vi.fn((handler) => {
        registeredHandler = handler;
      }),
    } satisfies Pick<Session, "setDisplayMediaRequestHandler">;
    const input = createInput();

    configureMeetDisplayMediaHandler({ meetSession, ...input });

    expect(meetSession.setDisplayMediaRequestHandler).toHaveBeenCalledWith(expect.any(Function), {
      useSystemPicker: true,
    });

    const callback = vi.fn();
    registeredHandler?.(createRequest(), callback);
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith({
        video: {
          id: "screen:1:0",
          name: "Entire Screen",
        },
      });
    });
  });

  it("denies through the registered handler when processing throws", async () => {
    let registeredHandler: DisplayMediaRequestHandler | undefined;
    const meetSession = {
      setDisplayMediaRequestHandler: vi.fn((handler) => {
        registeredHandler = handler;
      }),
    } satisfies Pick<Session, "setDisplayMediaRequestHandler">;
    configureMeetDisplayMediaHandler({
      meetSession,
      ...createInput({
        chooseSource: vi.fn(async () => {
          throw new Error("picker failed");
        }),
      }),
    });
    const callback = vi.fn();

    registeredHandler?.(createRequest(), callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith({});
    });
  });
});

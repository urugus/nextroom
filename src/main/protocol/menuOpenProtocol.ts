export const nextRoomProtocolScheme = "nextroom";
export const nextRoomMenuUrl = `${nextRoomProtocolScheme}://menu`;

export type MenuOpenRequestQueue = {
  drain: () => void;
  hasPendingRequest: () => boolean;
  requestOpen: () => void;
};

export type ProtocolClientRegistrationOptions = {
  args: string[];
  executable?: string;
};

export const protocolClientRegistrationOptions = ({
  argv,
  defaultApp,
  execPath,
}: {
  argv: readonly string[];
  defaultApp?: boolean;
  execPath: string;
}): ProtocolClientRegistrationOptions =>
  defaultApp === true && argv[1] !== undefined
    ? {
        args: [argv[1]],
        executable: execPath,
      }
    : { args: [] };

export const isMenuOpenProtocolUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === `${nextRoomProtocolScheme}:` &&
      url.hostname === "menu" &&
      (url.pathname === "" || url.pathname === "/")
    );
  } catch {
    return false;
  }
};

export const findMenuOpenProtocolUrl = (values: readonly string[]): string | undefined =>
  values.find(isMenuOpenProtocolUrl);

export const createMenuOpenRequestQueue = ({
  tryOpenMenu,
}: {
  tryOpenMenu: () => boolean;
}): MenuOpenRequestQueue => {
  let pendingRequest = false;

  const requestOpen = (): void => {
    if (tryOpenMenu()) {
      pendingRequest = false;
      return;
    }

    pendingRequest = true;
  };

  return {
    drain: () => {
      if (!pendingRequest) return;

      requestOpen();
    },
    hasPendingRequest: () => pendingRequest,
    requestOpen,
  };
};

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppError } from "@shared/errors";
import { err, ok, type Result, ResultAsync } from "neverthrow";

export type OAuthCallbackReceiver = {
  redirectUri: string;
  waitForCode: () => Promise<Result<string, AppError>>;
  close: () => void;
};

const callbackPath = "/oauth/callback";
const successHtml = "<!doctype html><title>NextRoom</title><p>NextRoom authorization complete.</p>";
const failureHtml = "<!doctype html><title>NextRoom</title><p>NextRoom authorization failed.</p>";

const closeServer = (server: Server): void => {
  if (server.listening) {
    server.close();
  }
};

export const createOAuthCallbackReceiver = (
  expectedState: string,
  timeoutMs = 120_000,
): ResultAsync<OAuthCallbackReceiver, AppError> =>
  ResultAsync.fromPromise(
    new Promise<OAuthCallbackReceiver>((resolve, reject) => {
      const server = createServer();
      let completeCallback!: (result: Result<string, AppError>) => void;
      const callbackResult = new Promise<Result<string, AppError>>((callbackResolve) => {
        completeCallback = callbackResolve;
      });
      let completed = false;

      const complete = (result: Result<string, AppError>, html: string): string => {
        if (!completed) {
          completed = true;
          clearTimeout(timeout);
          completeCallback(result);
          closeServer(server);
        }

        return html;
      };

      const timeout = setTimeout(() => {
        complete(
          err({ type: "OAuthFailed", cause: "Timed out waiting for Google authorization." }),
          failureHtml,
        );
      }, timeoutMs);

      server.on("request", (request, response) => {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

        if (requestUrl.pathname !== callbackPath) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        const responseHtml = (() => {
          const oauthError = requestUrl.searchParams.get("error");
          const state = requestUrl.searchParams.get("state");
          const code = requestUrl.searchParams.get("code");

          if (state !== expectedState) {
            return complete(
              err({ type: "OAuthFailed", cause: "OAuth state mismatch." }),
              failureHtml,
            );
          }

          if (oauthError !== null) {
            return complete(err({ type: "OAuthDenied", cause: oauthError }), failureHtml);
          }

          if (code === null || code.length === 0) {
            return complete(
              err({ type: "OAuthFailed", cause: "OAuth callback did not include a code." }),
              failureHtml,
            );
          }

          return complete(ok(code), successHtml);
        })();

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(responseHtml);
      });

      server.on("error", (cause) => {
        clearTimeout(timeout);
        reject(cause);
      });

      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        resolve({
          redirectUri: `http://127.0.0.1:${address.port}${callbackPath}`,
          waitForCode: () => callbackResult,
          close: () => {
            clearTimeout(timeout);
            closeServer(server);
          },
        });
      });
    }),
    (cause): AppError => ({ type: "OAuthFailed", cause }),
  );

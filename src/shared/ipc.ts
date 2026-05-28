import type { Result } from "neverthrow";
import type { AppError, SerializedAppError } from "./errors";
import { serializeAppError } from "./errors";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: SerializedAppError };

export const toApiResult = <T>(result: Result<T, AppError>): ApiResult<T> =>
  result.match(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error: serializeAppError(error) }),
  );

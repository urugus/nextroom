import type { AppError } from "@shared/errors";
import { type ApiResult, toApiResult } from "@shared/ipc";
import type { Result } from "neverthrow";

export const serializeResultForRenderer = <T>(result: Result<T, AppError>): ApiResult<T> =>
  toApiResult(result);

import type { AppError } from "@shared/errors";
import type { AppSettings } from "@shared/types";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

export const defaultAppSettings: AppSettings = {
  autoJoinEnabled: false,
  autoOpenEnabled: true,
  cameraBubbleChatMirrorEnabled: false,
  cameraBubbleEnabled: false,
  cameraBubbleSidebarHidden: false,
  cameraBubbleDisplaySpeedLevel: 3,
  joinOffsetSeconds: 0,
  notifyBeforeMinutes: 1,
  openOffsetSeconds: 0,
  menuShortcutAccelerator: "Command+Alt+N",
  launchAtLogin: false,
  calendarId: "primary",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
};

const minuteOffsetSchema = (fieldName: string) =>
  z
    .number()
    .int()
    .min(0)
    .max(10 * 60)
    .refine((value) => value % 60 === 0, {
      message: `${fieldName} must be a whole number of minutes`,
    });

const settingsSchema = z
  .object({
    autoJoinEnabled: z.boolean().optional(),
    autoOpenEnabled: z.boolean().optional(),
    cameraBubbleChatMirrorEnabled: z.boolean().optional(),
    cameraBubbleEnabled: z.boolean().optional(),
    cameraBubbleSidebarHidden: z.boolean().optional(),
    cameraBubbleDisplaySpeedLevel: z.number().int().min(1).max(5).optional(),
    joinOffsetSeconds: minuteOffsetSchema("joinOffsetSeconds").optional(),
    notifyBeforeMinutes: z.number().int().min(0).optional(),
    openOffsetSeconds: minuteOffsetSchema("openOffsetSeconds").optional(),
    menuShortcutAccelerator: z.string().trim().min(1).max(80).nullable().optional(),
    launchAtLogin: z.boolean().optional(),
    calendarId: z.literal("primary").optional(),
    timezone: z.string().min(1).optional(),
  })
  .strict();

const settingsUpdateSchema = settingsSchema
  .pick({
    autoJoinEnabled: true,
    cameraBubbleChatMirrorEnabled: true,
    cameraBubbleEnabled: true,
    cameraBubbleSidebarHidden: true,
    cameraBubbleDisplaySpeedLevel: true,
    joinOffsetSeconds: true,
    menuShortcutAccelerator: true,
    openOffsetSeconds: true,
  })
  .strict();

type SettingsUpdate = Partial<
  Pick<
    AppSettings,
    | "autoJoinEnabled"
    | "cameraBubbleChatMirrorEnabled"
    | "cameraBubbleEnabled"
    | "cameraBubbleSidebarHidden"
    | "cameraBubbleDisplaySpeedLevel"
    | "joinOffsetSeconds"
    | "menuShortcutAccelerator"
    | "openOffsetSeconds"
  >
>;

export const parseStoredAppSettings = (value: unknown): AppSettings => {
  const parsed = settingsSchema.safeParse(value);
  if (!parsed.success) return { ...defaultAppSettings };

  const settings = { ...defaultAppSettings, ...parsed.data };
  return settings.joinOffsetSeconds > settings.openOffsetSeconds
    ? { ...settings, joinOffsetSeconds: settings.openOffsetSeconds }
    : settings;
};

export const parseSettingsUpdate = (value: unknown): Result<SettingsUpdate, AppError> => {
  const parsed = settingsUpdateSchema.safeParse(value);
  if (!parsed.success) {
    return err({ type: "DatabaseFailed", cause: parsed.error.message });
  }

  return ok(parsed.data);
};

export const validateAppSettings = (settings: AppSettings): Result<AppSettings, AppError> => {
  if (settings.joinOffsetSeconds > settings.openOffsetSeconds) {
    return err({
      type: "DatabaseFailed",
      cause: "joinOffsetSeconds must be less than or equal to openOffsetSeconds",
    });
  }

  return ok(settings);
};

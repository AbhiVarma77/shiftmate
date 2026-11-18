import { z } from 'zod';

import { isValidDecimal } from '@/utils/money';
import { isValidLocalDate, isValidLocalTime } from '@/utils/time';

const localDate = z.string().refine(isValidLocalDate, 'Enter a valid date (YYYY-MM-DD).');
const localTime = z.string().refine(isValidLocalTime, 'Enter a valid time (HH:mm).');
const positiveDecimal = z
  .string()
  .trim()
  .refine((v) => isValidDecimal(v) && Number(v) >= 0, 'Enter a valid non-negative amount.');

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, e.g. GBP.');

export const overtimeInputSchema = z
  .object({
    dailyThresholdHours: z.number().positive().max(24).nullable(),
    weeklyThresholdHours: z.number().positive().max(168).nullable(),
    multiplier: positiveDecimal.refine((v) => Number(v) >= 1, 'Multiplier must be at least 1.'),
  })
  .refine((o) => o.dailyThresholdHours != null || o.weeklyThresholdHours != null, {
    message: 'Set a daily or weekly threshold.',
  });

export const jobInputSchema = z
  .object({
    companyName: z.string().trim().min(1, 'Company name is required.').max(80),
    jobTitle: z.string().trim().max(80).default(''),
    companyLogo: z.string().nullable().default(null),
    workplaceAddress: z.string().trim().max(200).nullable().default(null),
    employmentType: z.enum(['full_time', 'part_time', 'casual', 'temporary', 'freelance', 'other']).default('part_time'),
    currency: currencySchema,
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#10B981'),
    hourlyRate: positiveDecimal,
    defaultStartTime: localTime.nullable().default(null),
    defaultEndTime: localTime.nullable().default(null),
    defaultPaidBreakMinutes: z.number().int().min(0).max(600).default(0),
    defaultUnpaidBreakMinutes: z.number().int().min(0).max(600).default(0),
    employmentStartDate: localDate.nullable().default(null),
    employmentEndDate: localDate.nullable().default(null),
    notes: z.string().max(2000).nullable().default(null),
    overtime: overtimeInputSchema.nullable().default(null),
  })
  .refine((j) => !j.employmentStartDate || !j.employmentEndDate || j.employmentEndDate >= j.employmentStartDate, {
    message: 'End date must be after start date.',
    path: ['employmentEndDate'],
  });

export type JobInput = z.input<typeof jobInputSchema>;
export type ParsedJobInput = z.output<typeof jobInputSchema>;

export const manualShiftSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('times'),
    jobId: z.string().nullable(),
    shiftDate: localDate,
    startTime: localTime,
    endTime: localTime,
    paidBreakMinutes: z.number().int().min(0).default(0),
    unpaidBreakMinutes: z.number().int().min(0).default(0),
    notes: z.string().max(2000).nullable().default(null),
  }),
  z.object({
    mode: z.literal('duration'),
    jobId: z.string().nullable(),
    shiftDate: localDate,
    durationSeconds: z.number().int().positive('Duration must be more than zero.').max(24 * 3600, 'A shift cannot exceed 24 hours.'),
    paidBreakMinutes: z.number().int().min(0).default(0),
    unpaidBreakMinutes: z.number().int().min(0).default(0),
    notes: z.string().max(2000).nullable().default(null),
  }),
]);

export type ManualShiftInput = z.input<typeof manualShiftSchema>;

/** First human-readable message from a Zod error. */
export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input.';
}

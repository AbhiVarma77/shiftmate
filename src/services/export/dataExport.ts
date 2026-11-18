/**
 * "Download my data" — gathers every record for the account and renders a
 * printable HTML document (turned into a PDF by lib/pdf.ts).
 */
import type { Db } from '@/database/types';
import { listJobs, listOvertimeRules, listPayRates } from '@/repositories/jobsRepository';
import { type AppSettings, loadSettings } from '@/repositories/settingsRepository';
import { listShifts } from '@/repositories/shiftsRepository';
import type { Break, Job, OvertimeRule, PayRate, Shift } from '@/types/domain';
import { EMPLOYMENT_TYPE_LABELS } from '@/types/domain';
import { formatCurrencyTotals, formatDate } from '@/utils/format';
import { formatMoney } from '@/utils/money';
import { formatDuration, toLocalDate, toLocalTime } from '@/utils/time';

import type { PeriodSummary } from '../analytics';
import type { ShiftPay } from '../calculations/salary';
import { loadReport } from '../reportService';

export interface AccountExport {
  owner: { name: string | null; email: string | null };
  generatedAt: number;
  settings: AppSettings;
  jobs: { job: Job; payRates: PayRate[]; overtimeRules: OvertimeRule[] }[];
  shifts: Shift[];
  breaks: Map<string, Break[]>;
  pays: Map<string, ShiftPay>;
  summary: PeriodSummary | null;
  weeklyTargets: { jobId: string | null; targetSeconds: number }[];
}

export async function collectAccountData(
  db: Db,
  owner: AccountExport['owner'],
  now = Date.now(),
): Promise<AccountExport> {
  const settings = await loadSettings(db);
  const jobs = await listJobs(db, { includeArchived: true });
  const withRates = [];
  for (const job of jobs) {
    withRates.push({ job, payRates: await listPayRates(db, job.id), overtimeRules: await listOvertimeRules(db, job.id) });
  }

  const all = await listShifts(db, { includeActive: true });
  let summary: PeriodSummary | null = null;
  let shifts: Shift[] = [];
  let breaks = new Map<string, Break[]>();
  let pays = new Map<string, ShiftPay>();
  if (all.length) {
    const dates = all.map((s) => s.shiftDate).sort();
    const report = await loadReport(db, { from: dates[0], to: dates[dates.length - 1], weekStartsOn: settings.weekStartsOn }, now);
    summary = report.summary;
    shifts = [...report.shifts].sort(
      (a, b) => b.shiftDate.localeCompare(a.shiftDate) || (b.startAt ?? b.createdAt) - (a.startAt ?? a.createdAt),
    );
    breaks = report.breaks;
    pays = report.pays;
  }

  const weeklyTargets = (
    await db.getAllAsync<{ job_id: string | null; target_seconds: number }>(
      'SELECT job_id, target_seconds FROM weekly_targets WHERE deleted_at IS NULL',
    )
  ).map((r) => ({ jobId: r.job_id, targetSeconds: r.target_seconds }));

  return { owner, generatedAt: now, settings, jobs: withRates, shifts, breaks, pays, summary, weeklyTargets };
}

// ── HTML ─────────────────────────────────────────────────────────────────────

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dash = '—';
const orDash = (v: string | null | undefined) => (v ? esc(v) : dash);
const hours = (s: number) => `${formatDuration(s)} <span class="muted">(${formatDuration(s, 'decimal')}h)</span>`;
const longDate = (d: string) => formatDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = (d: string) => `<span class="nowrap">${formatDate(d, { day: 'numeric', month: 'short', year: 'numeric' })}</span>`;
/** The first pay rate/overtime rule starts at a far-past sentinel meaning "from the start". */
const fromDate = (d: string) => (d <= '1900-12-31' ? 'Since the start' : longDate(d));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function row(cells: (string | number)[], cls = ''): string {
  return `<tr${cls ? ` class="${cls}"` : ''}>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
}
function table(head: string[], rows: string[], empty: string): string {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
function kv(pairs: [string, string][]): string {
  return `<dl>${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function shiftTimes(s: Shift): string {
  if (s.startAt == null) return 'Duration only';
  const start = toLocalTime(s.startAt, s.timezone);
  if (s.endAt == null) return `${start} – <em>in progress</em>`;
  const end = toLocalTime(s.endAt, s.timezone);
  const nextDay = toLocalDate(s.endAt, s.timezone) !== s.shiftDate ? ' <span class="muted">(+1 day)</span>' : '';
  return `${start} – ${end}${nextDay}`;
}

function breakList(list: Break[], tz: string): string {
  if (!list.length) return dash;
  return list
    .map((b) => {
      const when = b.startAt != null ? `${toLocalTime(b.startAt, tz)}${b.endAt != null ? `–${toLocalTime(b.endAt, tz)}` : ' (active)'} ` : '';
      return `${b.breakType === 'paid' ? 'Paid' : 'Unpaid'} ${when}<span class="muted">${formatDuration(b.durationSeconds)}</span>`;
    })
    .join('<br>');
}

function shiftPay(s: Shift, pay: ShiftPay | undefined): string {
  if (!pay?.grossPay || !pay.currency) return '<span class="muted">No rate</span>';
  const ot = pay.overtimeSeconds > 0 && pay.overtimePay ? `<br><span class="muted">incl. OT ${formatMoney(pay.overtimePay, pay.currency)}</span>` : '';
  return `${formatMoney(pay.grossPay, pay.currency)}${ot}`;
}

export function renderAccountExportHtml(data: AccountExport): string {
  const jobName = new Map(data.jobs.map(({ job }) => [job.id, job.companyName]));
  const nameOf = (id: string | null) => (id ? esc(jobName.get(id) ?? 'Deleted job') : 'Unassigned');
  const currency = data.settings.defaultCurrency;
  const sm = data.summary;
  const generated = new Date(data.generatedAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });

  const summaryHtml = sm
    ? kv([
        ['Period', `${longDate(sm.from)} – ${longDate(sm.to)}`],
        ['Shifts', String(sm.shiftCount)],
        ['Days worked', String(sm.workingDays)],
        ['Total worked (net)', hours(sm.netSeconds)],
        ['Overtime', hours(sm.overtimeSeconds)],
        ['Paid breaks', formatDuration(sm.paidBreakSeconds)],
        ['Unpaid breaks', formatDuration(sm.unpaidBreakSeconds)],
        ['Average shift', formatDuration(sm.averageShiftSeconds)],
        ['Longest shift', formatDuration(sm.longestShiftSeconds)],
        ['Estimated gross earnings', `<strong>${esc(formatCurrencyTotals(sm.earnings, currency))}</strong>`],
        ...(sm.unpricedShifts ? ([['Shifts without a pay rate', String(sm.unpricedShifts)]] as [string, string][]) : []),
      ]) +
      `<h3>By job</h3>` +
      table(
        ['Job', 'Shifts', 'Worked', 'Overtime', 'Earnings'],
        sm.byJob.map((b) => row([nameOf(b.jobId), b.shiftCount, hours(b.netSeconds), formatDuration(b.overtimeSeconds), esc(formatCurrencyTotals(b.earnings, currency))])),
        'No shifts yet.',
      )
    : '<p class="muted">No shifts recorded yet.</p>';

  const jobsHtml = data.jobs.length
    ? data.jobs
        .map(({ job, payRates, overtimeRules }) => {
          const target = data.weeklyTargets.find((w) => w.jobId === job.id);
          return `<section class="job">
  <h3><span class="swatch" style="background:${esc(job.color)}"></span>${esc(job.companyName)}${job.isActive ? '' : ' <span class="tag">Archived</span>'}</h3>
  ${kv([
    ['Job title', orDash(job.jobTitle)],
    ['Employment type', esc(EMPLOYMENT_TYPE_LABELS[job.employmentType])],
    ['Workplace', orDash(job.workplaceAddress)],
    ['Currency', esc(job.currency)],
    ['Usual hours', job.defaultStartTime && job.defaultEndTime ? `${esc(job.defaultStartTime)} – ${esc(job.defaultEndTime)}` : dash],
    ['Usual breaks', `Paid ${formatDuration(job.defaultPaidBreakSeconds)} · Unpaid ${formatDuration(job.defaultUnpaidBreakSeconds)}`],
    ['Employed', job.employmentStartDate ? `${longDate(job.employmentStartDate)} – ${job.employmentEndDate ? longDate(job.employmentEndDate) : 'present'}` : dash],
    ['Weekly target', target ? formatDuration(target.targetSeconds) : dash],
    ['Notes', orDash(job.notes)],
  ])}
  <h4>Pay rate history</h4>
  ${table(
    ['Hourly rate', 'From', 'Until'],
    payRates.map((r) => row([esc(formatMoney(r.hourlyRate, r.currency)), fromDate(r.effectiveFrom), r.effectiveUntil ? longDate(r.effectiveUntil) : 'Current'])),
    'No pay rate set.',
  )}
  <h4>Overtime rules</h4>
  ${table(
    ['After (per day)', 'After (per week)', 'Multiplier', 'From', 'Until'],
    overtimeRules.map((r) =>
      row([
        r.dailyThresholdSeconds != null ? formatDuration(r.dailyThresholdSeconds) : dash,
        r.weeklyThresholdSeconds != null ? formatDuration(r.weeklyThresholdSeconds) : dash,
        `${esc(r.multiplier)}×`,
        fromDate(r.effectiveFrom),
        r.effectiveUntil ? longDate(r.effectiveUntil) : 'Current',
      ]),
    ),
    'No overtime rules.',
  )}
</section>`;
        })
        .join('')
    : '<p class="muted">No jobs added yet.</p>';

  const allJobsTarget = data.weeklyTargets.find((w) => w.jobId == null);
  const shiftsHtml = table(
    ['Date', 'Job', 'Time', 'Breaks', 'Worked', 'Rate', 'Est. pay', 'Notes'],
    data.shifts.map((s) =>
      row(
        [
          shortDate(s.shiftDate),
          nameOf(s.jobId),
          shiftTimes(s),
          breakList(data.breaks.get(s.id) ?? [], s.timezone),
          formatDuration(s.netWorkSeconds),
          s.hourlyRateSnapshot && s.currency ? esc(formatMoney(s.hourlyRateSnapshot, s.currency)) : dash,
          shiftPay(s, data.pays.get(s.id)),
          orDash(s.notes),
        ],
        s.status === 'completed' ? '' : 'active',
      ),
    ),
    'No shifts recorded yet.',
  );

  const st = data.settings;
  const settingsHtml = kv([
    ['Theme', esc(st.theme[0].toUpperCase() + st.theme.slice(1))],
    ['Week starts on', WEEKDAYS[st.weekStartsOn]],
    ['Default currency', esc(st.defaultCurrency)],
    ['Simultaneous shifts', st.allowConcurrentShifts ? 'Allowed' : 'Not allowed'],
    ['Weekly target (all jobs)', allJobsTarget ? formatDuration(allJobsTarget.targetSeconds) : dash],
  ]);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>ShiftMate — ${esc(data.owner.name ?? data.owner.email ?? 'My data')}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; color: #111827; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  header { border-bottom: 3px solid #10B981; padding-bottom: 10px; margin-bottom: 18px; }
  header h1 { font-size: 20pt; margin: 0; }
  header p { margin: 2px 0; color: #4B5563; }
  h2 { font-size: 13.5pt; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #E5E7EB; break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 14px 0 6px; break-after: avoid; }
  h4 { font-size: 10pt; margin: 10px 0 4px; color: #374151; break-after: avoid; }
  dl { display: grid; grid-template-columns: 170px 1fr; gap: 3px 12px; margin: 0; }
  dt { color: #6B7280; }
  dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 4px; }
  thead { display: table-header-group; }
  th { text-align: left; background: #F3F4F6; color: #374151; font-weight: 600; }
  th, td { padding: 5px 6px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
  tr { break-inside: avoid; }
  tr.active td { background: #ECFDF5; }
  .muted { color: #6B7280; }
  .nowrap { white-space: nowrap; }
  .tag { font-size: 8pt; background: #E5E7EB; border-radius: 4px; padding: 1px 6px; font-weight: 500; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  section.job { break-inside: avoid; margin-bottom: 14px; }
  footer { margin-top: 24px; color: #9CA3AF; font-size: 8.5pt; text-align: center; }
</style></head>
<body>
<header>
  <h1>ShiftMate — your data</h1>
  <p><strong>${orDash(data.owner.name)}</strong>${data.owner.email ? ` · ${esc(data.owner.email)}` : ''}</p>
  <p>Generated ${esc(generated)} · ${data.jobs.length} job(s) · ${data.shifts.length} shift(s)</p>
</header>
<h2>Summary</h2>
${summaryHtml}
<h2>Jobs</h2>
${jobsHtml}
<h2>All shifts</h2>
${shiftsHtml}
<h2>Settings</h2>
${settingsHtml}
<footer>Pay figures are gross estimates before tax and deductions, based on the rates and overtime rules above.</footer>
</body></html>`;
}

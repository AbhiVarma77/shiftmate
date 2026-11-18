import { migrate } from '@/database/migrations';
import { saveSetting } from '@/repositories/settingsRepository';
import { collectAccountData, renderAccountExportHtml } from '@/services/export/dataExport';
import { changePayRate, createJob, setJobActive } from '@/services/jobService';
import { createManualShift } from '@/services/shiftService';

import { createTestDb } from '../helpers/nodeDb';

const T0 = Date.parse('2026-11-10T09:00:00Z');
const owner = { name: 'Sam Rivera', email: 'sam@example.com' };

async function seeded() {
  const db = createTestDb();
  await migrate(db);
  const cafe = await createJob(db, { companyName: 'Northwind <Café>', jobTitle: 'Barista', currency: 'GBP', hourlyRate: '12.50' }, T0 - 1e9);
  const books = await createJob(db, { companyName: 'Harbour Books', jobTitle: 'Assistant', currency: 'GBP', hourlyRate: '14.00' }, T0 - 1e9);
  await changePayRate(db, cafe.id, '13.00', '2026-11-01', {}, T0 - 5e8);
  await createManualShift(
    db,
    { mode: 'times', jobId: cafe.id, shiftDate: '2026-11-09', startTime: '09:00', endTime: '17:00', paidBreakMinutes: 0, unpaidBreakMinutes: 30, notes: 'Opened the shop & did <stock>' },
    {},
    T0,
  );
  await createManualShift(db, { mode: 'times', jobId: books.id, shiftDate: '2026-10-20', startTime: '22:00', endTime: '02:00' }, {}, T0);
  await setJobActive(db, books.id, false, T0);
  await saveSetting(db, 'defaultCurrency', 'GBP', T0);
  return db;
}

describe('PDF data export', () => {
  it('collects every job, rate and shift for the account', async () => {
    const data = await collectAccountData(await seeded(), owner, T0);
    expect(data.jobs).toHaveLength(2); // archived jobs included
    expect(data.jobs.find((j) => j.job.jobTitle === 'Barista')!.payRates).toHaveLength(2);
    expect(data.shifts.map((s) => s.shiftDate)).toEqual(['2026-11-09', '2026-10-20']); // newest first
    expect(data.summary?.shiftCount).toBe(2);
    expect(data.pays.size).toBe(2);
  });

  it('renders a complete, escaped document', async () => {
    const html = renderAccountExportHtml(await collectAccountData(await seeded(), owner, T0));
    expect(html).toContain('Sam Rivera');
    expect(html).toContain('sam@example.com');
    expect(html).toContain('Northwind &lt;Café&gt;'); // user text is escaped
    expect(html).not.toContain('<Café>');
    expect(html).toContain('Opened the shop &amp; did &lt;stock&gt;');
    expect(html).toContain('Harbour Books');
    expect(html).toContain('Archived');
    expect(html).toContain('(+1 day)'); // overnight shift
    expect(html).toContain('Pay rate history');
    expect(html).toContain('£13.00');
    expect(html).toMatch(/2 shift\(s\)/);
  });

  it('handles an account with no records', async () => {
    const db = createTestDb();
    await migrate(db);
    const html = renderAccountExportHtml(await collectAccountData(db, { name: null, email: 'new@example.com' }, T0));
    expect(html).toContain('No shifts recorded yet.');
    expect(html).toContain('No jobs added yet.');
  });
});

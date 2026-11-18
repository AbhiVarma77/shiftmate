import { router } from 'expo-router';

import { Button } from '@/components/ui/Button';
import { Card, EmptyState, IconButton, JobDot, ListRow, Screen, Section } from '@/components/ui/Layout';
import { useJobs, useLive } from '@/hooks/data';
import { useTheme } from '@/theme/ThemeProvider';
import { EMPLOYMENT_TYPE_LABELS } from '@/types/domain';

export default function MyJobs() {
  const t = useTheme();
  const jobs = useJobs(true);
  const rates = useLive(
    (db) => db.getAllAsync<{ job_id: string; hourly_rate: string }>('SELECT job_id, hourly_rate FROM job_pay_rates WHERE deleted_at IS NULL AND effective_until IS NULL'),
    [],
  );
  const rateFor = (id: string) => rates.data?.find((r) => r.job_id === id)?.hourly_rate;
  const active = (jobs.data ?? []).filter((j) => j.isActive);
  const archived = (jobs.data ?? []).filter((j) => !j.isActive);

  return (
    <Screen back title="My Jobs" right={<IconButton icon="add" label="Add a job" tone="accent" onPress={() => router.push('/jobs/form')} />}>
      {jobs.data && jobs.data.length === 0 && (
        <Card>
          <EmptyState icon="briefcase" title="No jobs yet" message="Add each employer you work for to track their hours and pay separately." action={<Button label="Add a job" icon="add" onPress={() => router.push('/jobs/form')} />} />
        </Card>
      )}
      {active.length > 0 && (
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          {active.map((j, i) => (
            <ListRow
              key={j.id}
              title={j.companyName}
              subtitle={[j.jobTitle, EMPLOYMENT_TYPE_LABELS[j.employmentType]].filter(Boolean).join(' · ')}
              value={rateFor(j.id) ? `${rateFor(j.id)} ${j.currency}` : undefined}
              valueSub="per hour"
              leading={<JobDot color={j.color} size={12} />}
              onPress={() => router.push({ pathname: '/jobs/[id]', params: { id: j.id } })}
              last={i === active.length - 1}
            />
          ))}
        </Card>
      )}
      {archived.length > 0 && (
        <Section title="Archived">
          <Card padded={false} style={{ paddingHorizontal: t.spacing.lg, opacity: 0.75 }}>
            {archived.map((j, i) => (
              <ListRow key={j.id} title={j.companyName} subtitle="Archived · history kept" leading={<JobDot color={j.color} size={12} />} onPress={() => router.push({ pathname: '/jobs/[id]', params: { id: j.id } })} last={i === archived.length - 1} />
            ))}
          </Card>
        </Section>
      )}
    </Screen>
  );
}

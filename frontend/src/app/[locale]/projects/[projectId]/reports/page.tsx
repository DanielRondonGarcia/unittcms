import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import ReportsPage from './ReportsPage';
import type { LocaleCodeType } from '@/types/locale';
import type { ReportsMessages } from '@/types/report';

export async function generateMetadata({ params: { locale } }: { params: { locale: LocaleCodeType } }) {
  const t = await getTranslations({ locale, namespace: 'Reports' });
  return { title: `${t('title')} | UnitTCMS`, robots: { index: false, follow: false } };
}

export default function Page({ params }: { params: { projectId: string; locale: string } }) {
  const reports = useTranslations('Reports');
  const messages: ReportsMessages = {
    title: reports('title'),
    selection: reports('selection'),
    allScenarios: reports('all_scenarios'),
    explicitScenarios: reports('selected_scenarios'),
    execution: reports('execution'),
    chooseExecution: reports('choose_execution'),
    preview: reports('preview'),
    download: reports('download'),
    loading: reports('loading'),
    requestError: reports('request_error'),
    correlationId: reports('correlation_id'),
    noRuns: reports('no_runs'),
    noScenarios: reports('no_scenarios'),
    previewUnavailable: reports('preview_unavailable'),
  };

  return <ReportsPage projectId={params.projectId} locale={params.locale as LocaleCodeType} messages={messages} />;
}

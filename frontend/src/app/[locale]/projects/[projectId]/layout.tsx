import { useTranslations } from 'next-intl';
import Sidebar from './Sidebar';
import { ProjectMessages } from '@/types/project';

export default function SidebarLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const t = useTranslations('Project');
  const reportT = useTranslations('Reports');
  const messages: ProjectMessages = {
    toggleSidebar: t('toggle_sidebar'),
    home: t('home'),
    testCases: t('test_cases'),
    testRuns: t('test_runs'),
    reports: reportT('title'),
    members: t('members'),
    settings: t('settings'),
  };

  return (
    <>
      <div className="flex h-[calc(100vh-64px)] min-h-0 min-w-0 max-w-full overflow-x-auto border-t-1 dark:border-neutral-700">
        <Sidebar messages={messages} locale={locale} />
        <div className="flex min-h-0 min-w-0 w-full">
          <div className="min-h-0 min-w-0 flex-grow">{children}</div>
        </div>
      </div>
    </>
  );
}

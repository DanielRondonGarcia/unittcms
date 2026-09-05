import { Circle, CircleCheck, CircleDashed, CircleX, CircleSlash2 } from 'lucide-react';

type Props = {
  uid: string;
};

const statusIconColors: Record<string, string> = {
  untested: 'var(--run-case-status-untested)',
  passed: 'var(--run-case-status-passed)',
  retest: 'var(--run-case-status-retest)',
  failed: 'var(--run-case-status-failed)',
  skipped: 'var(--run-case-status-skipped)',
};

export default function RunCaseStatus({ uid }: Props) {
  if (uid === 'untested') {
    return <Circle size={16} color={statusIconColors.untested} />;
  } else if (uid === 'passed') {
    return <CircleCheck size={16} color={statusIconColors.passed} />;
  } else if (uid === 'retest') {
    return <CircleDashed size={16} color={statusIconColors.retest} />;
  } else if (uid === 'failed') {
    return <CircleX size={16} color={statusIconColors.failed} />;
  } else if (uid === 'skipped') {
    return <CircleSlash2 size={16} color={statusIconColors.skipped} />;
  }
}

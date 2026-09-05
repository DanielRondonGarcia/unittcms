'use client';

import { useSelectedLayoutSegments } from 'next/navigation';
import type { ComponentProps, ReactNode } from 'react';

import ResizablePanes from '@/components/ResizablePane';
import RunEditor from './RunEditor';

type Props = {
  children: ReactNode;
  runEditorProps: ComponentProps<typeof RunEditor>;
};

export default function RunLayoutContent({ children, runEditorProps }: Props) {
  const selectedSegments = useSelectedLayoutSegments();
  const hasSelectedCase = selectedSegments[0] === 'cases' && Boolean(selectedSegments[1]);
  const runEditor = <RunEditor {...runEditorProps} />;

  return (
    <ResizablePanes
      defaultLeftWidth={60}
      minLeftWidth={50}
      minRightWidth={30}
      leftPane={runEditor}
      rightPane={children}
      rightPaneVisible={hasSelectedCase}
    />
  );
}

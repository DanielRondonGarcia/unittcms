'use client';
import { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { addToast } from '@heroui/react';
import { useRouter, useSearchParams } from 'next/navigation';
import TestCaseTable from './TestCaseTable';
import CaseDialog from './CaseDialog';
import CaseMoveDialog from './CaseMoveDialog';
import CaseImportDialog from './CaseImportDialog';
import DeleteConfirmDialog from '@/components/DeleteConfirmDialog';
import { TokenContext } from '@/utils/TokenProvider';
import { fetchCases, createCase, deleteCases, exportCases, reorderCases } from '@/utils/caseControl';
import { CaseType, CasesMessages } from '@/types/case';
import { PriorityMessages } from '@/types/priority';
import { TestTypeMessages } from '@/types/testType';
import { LocaleCodeType } from '@/types/locale';
import { logError } from '@/utils/errorHandler';
import { parseQueryParam } from '@/utils/parseQueryParam';
import { onMoveEvent } from '@/utils/testCaseMoveEvent';

type Props = {
  projectId: string;
  folderId: string;
  messages: CasesMessages;
  priorityMessages: PriorityMessages;
  testTypeMessages: TestTypeMessages;
  locale: LocaleCodeType;
};

export default function CasesPane({
  projectId,
  folderId,
  messages,
  priorityMessages,
  testTypeMessages,
  locale,
}: Props) {
  const [cases, setCases] = useState<CaseType[]>([]);
  const serverConfirmedCasesRef = useRef<CaseType[]>([]);
  const [isCaseDialogOpen, setIsCaseDialogOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<number[]>([]);
  const [typeFilter, setTypeFilter] = useState<number[]>([]);
  const [tagFilter, setTagFilter] = useState<number[]>([]);
  const [isDeleteConfirmDialogOpen, setIsDeleteConfirmDialogOpen] = useState(false);
  const [deleteCaseIds, setDeleteCaseIds] = useState<number[]>([]);

  const context = useContext(TokenContext);
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateUrlParams = (updates: { search?: string; priority?: number[]; type?: number[]; tag?: number[] }) => {
    const currentParams = new URLSearchParams(searchParams.toString());

    if (updates.search) {
      currentParams.set('search', updates.search);
    } else {
      currentParams.delete('search');
    }

    if (updates.priority && updates.priority.length > 0) {
      currentParams.set('priority', updates.priority.join(','));
    } else {
      currentParams.delete('priority');
    }

    if (updates.type && updates.type.length > 0) {
      currentParams.set('type', updates.type.join(','));
    } else {
      currentParams.delete('type');
    }

    if (updates.tag && updates.tag.length > 0) {
      currentParams.set('tag', updates.tag.join(','));
    } else {
      currentParams.delete('tag');
    }

    const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
    router.push(newUrl, { scroll: false });
  };

  const refreshCases = useCallback(async (): Promise<CaseType[] | undefined> => {
    if (!context.isSignedIn()) return undefined;

    const searchParam = searchParams.get('search') || '';
    const priorityParam = parseQueryParam(searchParams.get('priority'));
    const typeParam = parseQueryParam(searchParams.get('type'));
    const tagParam = parseQueryParam(searchParams.get('tag'));

    setSearchFilter(searchParam);
    setPriorityFilter(priorityParam);
    setTypeFilter(typeParam);
    setTagFilter(tagParam);

    try {
      const data = await fetchCases(
        context.token.access_token,
        Number(folderId),
        searchParam || undefined,
        priorityParam.length > 0 ? priorityParam : undefined,
        typeParam.length > 0 ? typeParam : undefined,
        tagParam.length > 0 ? tagParam : undefined
      );
      serverConfirmedCasesRef.current = data;
      setCases(data);
      return data;
    } catch (error: unknown) {
      logError('Error fetching cases:', error);
      return undefined;
    }
  }, [context, folderId, searchParams]);

  useEffect(() => {
    refreshCases();
  }, [refreshCases]);

  const closeDialog = () => setIsCaseDialogOpen(false);

  const onSubmit = async (title: string, description: string, template: number, createMore: boolean) => {
    const newCase = await createCase(context.token.access_token, folderId, title, description, template);
    const nextCases = [...cases, newCase];
    serverConfirmedCasesRef.current = nextCases;
    setCases(nextCases);
    if (!createMore) {
      closeDialog();
    }
  };

  const closeDeleteConfirmDialog = () => {
    setIsDeleteConfirmDialogOpen(false);
    setDeleteCaseIds([]);
  };

  const onDeleteCase = (deleteCaseId: number) => {
    setDeleteCaseIds([deleteCaseId]);
    setIsDeleteConfirmDialogOpen(true);
  };

  const onDeleteCases = (deleteCaseIds: number[]) => {
    setDeleteCaseIds(deleteCaseIds);
    setIsDeleteConfirmDialogOpen(true);
  };

  const onConfirm = async () => {
    if (deleteCaseIds.length > 0) {
      await deleteCases(context.token.access_token, deleteCaseIds, Number(projectId));
      const nextCases = cases.filter((entry) => !deleteCaseIds.includes(entry.id));
      serverConfirmedCasesRef.current = nextCases;
      setCases(nextCases);
      closeDeleteConfirmDialog();
    }
  };

  const onExportCases = async (type: string) => {
    await exportCases(context.token.access_token, Number(folderId), type);
  };

  const handleFilterChange = (search: string, priorities: number[], types: number[], tag: number[]) => {
    setSearchFilter(search);
    setPriorityFilter(priorities);
    setTypeFilter(types);
    setTagFilter(tag);
    updateUrlParams({ search: search, priority: priorities, type: types, tag: tag });
  };

  const handleReorderCases = useCallback(
    async (sourceFolderId: number, orderedCaseIds: number[]): Promise<boolean> => {
      const currentFolderId = Number(folderId);
      const confirmedCases = serverConfirmedCasesRef.current;
      if (sourceFolderId !== currentFolderId) return false;

      try {
        const result = await reorderCases(context.token.access_token, sourceFolderId, orderedCaseIds);
        if (!result.ok) {
          setCases(confirmedCases.slice());
          addToast({
            title: messages.errorTitle,
            color: 'danger',
            description: 'Unable to save case order. The last server-confirmed order was restored.',
          });
          return false;
        }

        const committedPositions = new Map(result.data.committed.map((entry) => [entry.id, entry.position]));
        const confirmedCasesById = new Map(confirmedCases.map((entry) => [entry.id, entry]));
        const reconciledCases = result.data.orderedCaseIds
          .map((caseId) => {
            const confirmedCase = confirmedCasesById.get(caseId);
            if (!confirmedCase) return undefined;
            const position = committedPositions.get(caseId);
            return position === undefined ? confirmedCase : { ...confirmedCase, position };
          })
          .filter((entry): entry is CaseType => entry !== undefined);
        const hasCompleteResponse = reconciledCases.length === confirmedCases.length;
        if (hasCompleteResponse) {
          serverConfirmedCasesRef.current = reconciledCases;
          setCases(reconciledCases);
        }

        const refreshedCases = await refreshCases();
        if (refreshedCases === undefined) {
          if (hasCompleteResponse) {
            addToast({
              title: messages.successTitle,
              color: 'success',
              description: 'Case order saved; the list was reconciled from the server response.',
            });
            return true;
          }

          setCases(confirmedCases.slice());
          addToast({
            title: messages.errorTitle,
            color: 'danger',
            description: 'Unable to refresh case order. The last server-confirmed order was restored.',
          });
          return false;
        }

        addToast({
          title: messages.successTitle,
          color: 'success',
          description: 'Case order saved.',
        });
        return true;
      } catch (error: unknown) {
        logError('Error reordering cases:', error);
        setCases(confirmedCases.slice());
        addToast({
          title: messages.errorTitle,
          color: 'danger',
          description: 'Unable to save case order. The last server-confirmed order was restored.',
        });
        return false;
      }
    },
    [context, folderId, messages, refreshCases]
  );

  // **************************************************************************
  // Move/Clone cases
  // **************************************************************************
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [selectedCaseIds, setSelectedCaseIds] = useState<number[]>([]);
  const [targetFolderId, setTargetFolderId] = useState<number | undefined>(undefined);
  const openMoveDialog = useCallback((caseIds: number[], folderId?: number) => {
    setSelectedCaseIds(caseIds);
    setTargetFolderId(folderId);
    setIsMoveDialogOpen(true);
  }, []);

  const handleMoved = () => {
    const nextCases = serverConfirmedCasesRef.current.filter((c) => !selectedCaseIds.includes(c.id));
    serverConfirmedCasesRef.current = nextCases;
    setCases(nextCases);
  };

  useEffect(() => {
    const unsubscribe = onMoveEvent(async (e) => {
      const { testCaseIds, targetFolderId } = e.detail;
      openMoveDialog(testCaseIds, targetFolderId);
    });
    return unsubscribe;
  }, [openMoveDialog]);

  // **************************************************************************
  // Import cases
  // **************************************************************************
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const handleImport = () => {
    refreshCases();
    setIsImportDialogOpen(false);
    addToast({
      title: messages.successTitle,
      color: 'success',
      description: messages.casesImported,
    });
  };

  return (
    <>
      <TestCaseTable
        projectId={projectId}
        folderId={Number(folderId)}
        isDisabled={!context.isProjectDeveloper(Number(projectId))}
        cases={cases}
        onCreateCase={() => setIsCaseDialogOpen(true)}
        onDeleteCase={onDeleteCase}
        onDeleteCases={onDeleteCases}
        onReorderCases={handleReorderCases}
        onShowImportDialog={() => setIsImportDialogOpen(true)}
        onExportCases={onExportCases}
        onFilterChange={handleFilterChange}
        activeSearchFilter={searchFilter}
        activePriorityFilters={priorityFilter}
        activeTypeFilters={typeFilter}
        activeTagFilters={tagFilter}
        messages={messages}
        priorityMessages={priorityMessages}
        testTypeMessages={testTypeMessages}
        locale={locale}
      />

      <CaseDialog isOpen={isCaseDialogOpen} onCancel={closeDialog} onSubmit={onSubmit} messages={messages} />

      <CaseMoveDialog
        isOpen={isMoveDialogOpen}
        testCaseIds={selectedCaseIds}
        projectId={projectId}
        targetFolderId={targetFolderId}
        isDisabled={!context.isProjectDeveloper(Number(projectId))}
        onCancel={() => setIsMoveDialogOpen(false)}
        onMoved={handleMoved}
        messages={messages}
        token={context.token.access_token}
      />

      <CaseImportDialog
        isOpen={isImportDialogOpen}
        folderId={Number(folderId)}
        isDisabled={!context.isProjectDeveloper(Number(projectId))}
        onImport={handleImport}
        onCancel={() => setIsImportDialogOpen(false)}
        messages={messages}
        token={context.token.access_token}
      />

      <DeleteConfirmDialog
        isOpen={isDeleteConfirmDialogOpen}
        onCancel={closeDeleteConfirmDialog}
        onConfirm={onConfirm}
        closeText={messages.close}
        confirmText={messages.areYouSure}
        deleteText={messages.delete}
      />
    </>
  );
}

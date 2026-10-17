import { contextStoreCurrentViewIdComponentState } from '@/context-store/states/contextStoreCurrentViewIdComponentState';
import { currentRecordFilterGroupsComponentState } from '@/object-record/record-filter-group/states/currentRecordFilterGroupsComponentState';
import { currentRecordFiltersComponentState } from '@/object-record/record-filter/states/currentRecordFiltersComponentState';
import { useRecordIndexContextOrThrow } from '@/object-record/record-index/contexts/RecordIndexContext';
import { useAtomComponentFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentFamilyStateValue';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { useAreViewFilterGroupsDifferentFromRecordFilterGroups } from '@/views/hooks/useAreViewFilterGroupsDifferentFromRecordFilterGroups';
import { useAreViewFiltersDifferentFromRecordFilters } from '@/views/hooks/useAreViewFiltersDifferentFromRecordFilters';
import { useGetCurrentViewOnly } from '@/views/hooks/useGetCurrentViewOnly';
import { hasInitializedCurrentRecordFilterGroupsComponentFamilyState } from '@/views/states/hasInitializedCurrentRecordFilterGroupsComponentFamilyState';
import { hasInitializedCurrentRecordFiltersComponentFamilyState } from '@/views/states/hasInitializedCurrentRecordFiltersComponentFamilyState';
import { unsavedViewFiltersByViewIdState } from '@/views/states/unsavedViewFiltersByViewIdState';
import { useEffect } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { isDeeplyEqual } from '~/utils/isDeeplyEqual';

export const ViewBarUnsavedFiltersPersistEffect = () => {
  const contextStoreCurrentViewId = useAtomComponentStateValue(
    contextStoreCurrentViewIdComponentState,
  );

  const { objectMetadataItem } = useRecordIndexContextOrThrow();

  const { currentView } = useGetCurrentViewOnly();

  const hasInitializedCurrentRecordFilters = useAtomComponentFamilyStateValue(
    hasInitializedCurrentRecordFiltersComponentFamilyState,
    { viewId: contextStoreCurrentViewId ?? undefined },
  );

  const hasInitializedCurrentRecordFilterGroups =
    useAtomComponentFamilyStateValue(
      hasInitializedCurrentRecordFilterGroupsComponentFamilyState,
      { viewId: contextStoreCurrentViewId ?? undefined },
    );

  const currentRecordFilters = useAtomComponentStateValue(
    currentRecordFiltersComponentState,
  );

  const currentRecordFilterGroups = useAtomComponentStateValue(
    currentRecordFilterGroupsComponentState,
  );

  const { viewFiltersAreDifferentFromRecordFilters } =
    useAreViewFiltersDifferentFromRecordFilters();

  const { viewFilterGroupsAreDifferentFromRecordFilterGroups } =
    useAreViewFilterGroupsDifferentFromRecordFilterGroups();

  const setUnsavedViewFiltersByViewId = useSetAtomState(
    unsavedViewFiltersByViewIdState,
  );

  const hasUnsavedFilters =
    viewFiltersAreDifferentFromRecordFilters ||
    viewFilterGroupsAreDifferentFromRecordFilterGroups;

  useEffect(() => {
    if (
      !isDefined(currentView) ||
      currentView.objectMetadataId !== objectMetadataItem.id ||
      !hasInitializedCurrentRecordFilters ||
      !hasInitializedCurrentRecordFilterGroups
    ) {
      return;
    }

    const viewId = currentView.id;

    if (hasUnsavedFilters) {
      setUnsavedViewFiltersByViewId((previousUnsavedViewFiltersByViewId) => {
        const unsavedViewFilters = {
          recordFilters: currentRecordFilters,
          recordFilterGroups: currentRecordFilterGroups,
        };

        if (
          isDeeplyEqual(
            previousUnsavedViewFiltersByViewId[viewId],
            unsavedViewFilters,
          )
        ) {
          return previousUnsavedViewFiltersByViewId;
        }

        return {
          ...previousUnsavedViewFiltersByViewId,
          [viewId]: unsavedViewFilters,
        };
      });

      return;
    }

    setUnsavedViewFiltersByViewId((previousUnsavedViewFiltersByViewId) => {
      if (!isDefined(previousUnsavedViewFiltersByViewId[viewId])) {
        return previousUnsavedViewFiltersByViewId;
      }

      const { [viewId]: _clearedViewFilters, ...remainingUnsavedViewFilters } =
        previousUnsavedViewFiltersByViewId;

      return remainingUnsavedViewFilters;
    });
  }, [
    currentView,
    objectMetadataItem.id,
    hasInitializedCurrentRecordFilters,
    hasInitializedCurrentRecordFilterGroups,
    hasUnsavedFilters,
    currentRecordFilters,
    currentRecordFilterGroups,
    setUnsavedViewFiltersByViewId,
  ]);

  return null;
};

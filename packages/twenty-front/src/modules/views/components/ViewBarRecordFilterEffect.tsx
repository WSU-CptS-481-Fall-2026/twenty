import { contextStoreCurrentViewIdComponentState } from '@/context-store/states/contextStoreCurrentViewIdComponentState';
import { currentRecordFiltersComponentState } from '@/object-record/record-filter/states/currentRecordFiltersComponentState';
import { useRecordIndexContextOrThrow } from '@/object-record/record-index/contexts/RecordIndexContext';
import { useAtomComponentFamilyState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentFamilyState';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { useSetAtomComponentState } from '@/ui/utilities/state/jotai/hooks/useSetAtomComponentState';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';
import { useMapViewFiltersToFilters } from '@/views/hooks/useMapViewFiltersToFilters';
import { hasInitializedCurrentRecordFiltersComponentFamilyState } from '@/views/states/hasInitializedCurrentRecordFiltersComponentFamilyState';
import { viewFromViewIdFamilySelector } from '@/views/states/selectors/viewFromViewIdFamilySelector';
import { unsavedViewFiltersByViewIdState } from '@/views/states/unsavedViewFiltersByViewIdState';
import { useStore } from 'jotai';
import { useEffect } from 'react';
import { isDefined } from 'twenty-shared/utils';

export const ViewBarRecordFilterEffect = () => {
  const contextStoreCurrentViewId = useAtomComponentStateValue(
    contextStoreCurrentViewIdComponentState,
  );

  const { objectMetadataItem, recordIndexId } = useRecordIndexContextOrThrow();

  const currentView = useAtomFamilySelectorValue(viewFromViewIdFamilySelector, {
    viewId: contextStoreCurrentViewId ?? '',
  });

  const [
    hasInitializedCurrentRecordFilters,
    setHasInitializedCurrentRecordFilters,
  ] = useAtomComponentFamilyState(
    hasInitializedCurrentRecordFiltersComponentFamilyState,
    {
      viewId: contextStoreCurrentViewId ?? undefined,
    },
  );

  const setCurrentRecordFilters = useSetAtomComponentState(
    currentRecordFiltersComponentState,
    recordIndexId,
  );

  const store = useStore();

  const { mapViewFiltersToRecordFilters } = useMapViewFiltersToFilters();

  useEffect(() => {
    if (!hasInitializedCurrentRecordFilters && isDefined(currentView)) {
      if (currentView.objectMetadataId !== objectMetadataItem.id) {
        return;
      }

      setCurrentRecordFilters(
        store.get(unsavedViewFiltersByViewIdState.atom)[currentView.id]
          ?.recordFilters ??
          mapViewFiltersToRecordFilters(currentView.viewFilters),
      );

      setHasInitializedCurrentRecordFilters(true);
    }
  }, [
    contextStoreCurrentViewId,
    setCurrentRecordFilters,
    mapViewFiltersToRecordFilters,
    hasInitializedCurrentRecordFilters,
    setHasInitializedCurrentRecordFilters,
    currentView,
    objectMetadataItem,
    store,
  ]);

  return null;
};

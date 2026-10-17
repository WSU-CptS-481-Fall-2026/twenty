import { contextStoreCurrentViewIdComponentState } from '@/context-store/states/contextStoreCurrentViewIdComponentState';
import { useAtomComponentStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState';
import { useApplyCurrentViewFilterGroupsToCurrentRecordFilterGroups } from '@/views/hooks/useApplyCurrentViewFilterGroupsToCurrentRecordFilterGroups';
import { useApplyCurrentViewFiltersToCurrentRecordFilters } from '@/views/hooks/useApplyCurrentViewFiltersToCurrentRecordFilters';
import { useChangeView } from '@/views/hooks/useChangeView';
import { useCreateViewFromCurrentView } from '@/views/hooks/useCreateViewFromCurrentView';
import { unsavedViewFiltersByViewIdState } from '@/views/states/unsavedViewFiltersByViewIdState';
import { ViewType } from '@/views/types/ViewType';
import { useCloseAndResetViewPicker } from '@/views/view-picker/hooks/useCloseAndResetViewPicker';
import { viewPickerCalendarFieldMetadataIdComponentState } from '@/views/view-picker/states/viewPickerCalendarFieldMetadataIdComponentState';
import { viewPickerInputNameComponentState } from '@/views/view-picker/states/viewPickerInputNameComponentState';
import { viewPickerIsDirtyComponentState } from '@/views/view-picker/states/viewPickerIsDirtyComponentState';
import { viewPickerIsPersistingComponentState } from '@/views/view-picker/states/viewPickerIsPersistingComponentState';
import { viewPickerMainGroupByFieldMetadataIdComponentState } from '@/views/view-picker/states/viewPickerMainGroupByFieldMetadataIdComponentState';
import { viewPickerModeComponentState } from '@/views/view-picker/states/viewPickerModeComponentState';
import { viewPickerSelectedIconComponentState } from '@/views/view-picker/states/viewPickerSelectedIconComponentState';
import { viewPickerTypeComponentState } from '@/views/view-picker/states/viewPickerTypeComponentState';
import { viewPickerVisibilityComponentState } from '@/views/view-picker/states/viewPickerVisibilityComponentState';
import { useStore } from 'jotai';
import { useCallback } from 'react';
import { isDefined } from 'twenty-shared/utils';

export const useCreateViewFromCurrentState = () => {
  const { closeAndResetViewPicker } = useCloseAndResetViewPicker();

  const viewPickerInputNameCallbackState = useAtomComponentStateCallbackState(
    viewPickerInputNameComponentState,
  );

  const viewPickerSelectedIconCallbackState =
    useAtomComponentStateCallbackState(viewPickerSelectedIconComponentState);

  const viewPickerTypeCallbackState = useAtomComponentStateCallbackState(
    viewPickerTypeComponentState,
  );

  const viewPickerMainGroupByFieldMetadataIdCallbackState =
    useAtomComponentStateCallbackState(
      viewPickerMainGroupByFieldMetadataIdComponentState,
    );

  const viewPickerCalendarFieldMetadataIdCallbackState =
    useAtomComponentStateCallbackState(
      viewPickerCalendarFieldMetadataIdComponentState,
    );

  const viewPickerIsPersistingCallbackState =
    useAtomComponentStateCallbackState(viewPickerIsPersistingComponentState);

  const viewPickerIsDirtyCallbackState = useAtomComponentStateCallbackState(
    viewPickerIsDirtyComponentState,
  );

  const viewPickerModeCallbackState = useAtomComponentStateCallbackState(
    viewPickerModeComponentState,
  );

  const viewPickerVisibilityCallbackState = useAtomComponentStateCallbackState(
    viewPickerVisibilityComponentState,
  );

  const currentViewIdCallbackState = useAtomComponentStateCallbackState(
    contextStoreCurrentViewIdComponentState,
  );

  const { createViewFromCurrentView } = useCreateViewFromCurrentView();
  const { changeView } = useChangeView();

  const { applyCurrentViewFiltersToCurrentRecordFilters } =
    useApplyCurrentViewFiltersToCurrentRecordFilters();

  const { applyCurrentViewFilterGroupsToCurrentRecordFilterGroups } =
    useApplyCurrentViewFilterGroupsToCurrentRecordFilterGroups();

  const store = useStore();

  const createViewFromCurrentState = useCallback(async () => {
    const name = store.get(viewPickerInputNameCallbackState);
    const iconKey = store.get(viewPickerSelectedIconCallbackState);
    const type = store.get(viewPickerTypeCallbackState);
    const mainGroupByFieldMetadataId = store.get(
      viewPickerMainGroupByFieldMetadataIdCallbackState,
    );
    const calendarFieldMetadataId = store.get(
      viewPickerCalendarFieldMetadataIdCallbackState,
    );

    const viewPickerMode = store.get(viewPickerModeCallbackState);
    const visibility = store.get(viewPickerVisibilityCallbackState);
    const sourceViewId = store.get(currentViewIdCallbackState);

    const shouldCopyFiltersAndSortsAndAggregate =
      viewPickerMode === 'create-from-current';

    store.set(viewPickerIsPersistingCallbackState, true);
    store.set(viewPickerIsDirtyCallbackState, false);

    const createdViewId = await createViewFromCurrentView(
      {
        name,
        icon: iconKey,
        type,
        mainGroupByFieldMetadataId:
          type === ViewType.KANBAN ? mainGroupByFieldMetadataId : null,
        calendarFieldMetadataId,
        calendarEndFieldMetadataId: null,
        visibility,
      },
      shouldCopyFiltersAndSortsAndAggregate,
    );

    if (isDefined(createdViewId)) {
      if (shouldCopyFiltersAndSortsAndAggregate && isDefined(sourceViewId)) {
        applyCurrentViewFiltersToCurrentRecordFilters();
        applyCurrentViewFilterGroupsToCurrentRecordFilterGroups();

        store.set(
          unsavedViewFiltersByViewIdState.atom,
          ({
            [sourceViewId]: _savedToNewViewFilters,
            ...remainingUnsavedViewFilters
          }) => remainingUnsavedViewFilters,
        );
      }

      closeAndResetViewPicker();
      changeView(createdViewId);
    }
  }, [
    store,
    currentViewIdCallbackState,
    applyCurrentViewFiltersToCurrentRecordFilters,
    applyCurrentViewFilterGroupsToCurrentRecordFilterGroups,
    closeAndResetViewPicker,
    createViewFromCurrentView,
    changeView,
    viewPickerInputNameCallbackState,
    viewPickerIsDirtyCallbackState,
    viewPickerIsPersistingCallbackState,
    viewPickerMainGroupByFieldMetadataIdCallbackState,
    viewPickerCalendarFieldMetadataIdCallbackState,
    viewPickerSelectedIconCallbackState,
    viewPickerTypeCallbackState,
    viewPickerModeCallbackState,
    viewPickerVisibilityCallbackState,
  ]);

  return { createViewFromCurrentState };
};

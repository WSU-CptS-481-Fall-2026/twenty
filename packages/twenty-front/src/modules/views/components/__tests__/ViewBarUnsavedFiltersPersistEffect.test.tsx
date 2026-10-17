import { render } from '@testing-library/react';
import { type Store } from 'jotai/vanilla/store';

import { currentRecordFiltersComponentState } from '@/object-record/record-filter/states/currentRecordFiltersComponentState';
import { type RecordFilter } from '@/object-record/record-filter/types/RecordFilter';
import { jotaiStore } from '@/ui/utilities/state/jotai/jotaiStore';
import { ViewBarUnsavedFiltersPersistEffect } from '@/views/components/ViewBarUnsavedFiltersPersistEffect';
import { hasInitializedCurrentRecordFilterGroupsComponentFamilyState } from '@/views/states/hasInitializedCurrentRecordFilterGroupsComponentFamilyState';
import { hasInitializedCurrentRecordFiltersComponentFamilyState } from '@/views/states/hasInitializedCurrentRecordFiltersComponentFamilyState';
import {
  type UnsavedViewFilters,
  unsavedViewFiltersByViewIdState,
} from '@/views/states/unsavedViewFiltersByViewIdState';
import { type ViewWithRelations } from '@/views/types/ViewWithRelations';
import { ViewFilterOperand } from 'twenty-shared/types';
import { getFilterTypeFromFieldType, isDefined } from 'twenty-shared/utils';
import { getJestMetadataAndApolloMocksAndCommandMenuWrapper } from '~/testing/jest/getJestMetadataAndApolloMocksAndCommandMenuWrapper';
import { mockedViews } from '~/testing/mock-data/generated/metadata/views/mock-views-data';
import { getTestEnrichedObjectMetadataItemsMock } from '~/testing/utils/getTestEnrichedObjectMetadataItemsMock';
import { setTestViewsInMetadataStore } from '~/testing/utils/setTestViewsInMetadataStore';

const RECORD_INDEX_ID = 'recordIndexId';

const companyObjectMetadataItem = getTestEnrichedObjectMetadataItemsMock().find(
  (objectMetadataItem) => objectMetadataItem.nameSingular === 'company',
);

if (!isDefined(companyObjectMetadataItem)) {
  throw new Error('Missing mock object metadata item "company"');
}

const allCompaniesView = {
  ...mockedViews.find((view) => view.name === 'All Companies')!,
  viewFilters: [],
  viewFilterGroups: [],
} satisfies ViewWithRelations;

const nameFieldMetadataItem = companyObjectMetadataItem.fields.find(
  (fieldMetadataItem) => fieldMetadataItem.name === 'name',
)!;

const unsavedRecordFilter: RecordFilter = {
  id: 'unsaved-filter-id',
  fieldMetadataId: nameFieldMetadataItem.id,
  value: 'Acme',
  displayValue: 'Acme',
  operand: ViewFilterOperand.CONTAINS,
  label: nameFieldMetadataItem.label,
  type: getFilterTypeFromFieldType(nameFieldMetadataItem.type),
};

const previousUnsavedViewFilters: UnsavedViewFilters = {
  recordFilters: [{ ...unsavedRecordFilter, id: 'previous-filter-id' }],
  recordFilterGroups: [],
};

const renderPersistEffect = ({
  currentRecordFilters,
  hasInitializedFilters,
  unsavedViewFiltersByViewId = {},
}: {
  currentRecordFilters: RecordFilter[];
  hasInitializedFilters: boolean;
  unsavedViewFiltersByViewId?: Record<string, UnsavedViewFilters>;
}) =>
  render(<ViewBarUnsavedFiltersPersistEffect />, {
    wrapper: getJestMetadataAndApolloMocksAndCommandMenuWrapper({
      apolloMocks: [],
      componentInstanceId: 'instanceId',
      contextStoreCurrentObjectMetadataNameSingular: 'company',
      contextStoreCurrentViewId: allCompaniesView.id,
      onInitializeJotaiStore: (store: Store) => {
        setTestViewsInMetadataStore(store, [allCompaniesView]);

        store.set(
          currentRecordFiltersComponentState.atomFamily({
            instanceId: RECORD_INDEX_ID,
          }),
          currentRecordFilters,
        );

        store.set(
          hasInitializedCurrentRecordFiltersComponentFamilyState.atomFamily({
            instanceId: RECORD_INDEX_ID,
            familyKey: { viewId: allCompaniesView.id },
          }),
          hasInitializedFilters,
        );

        store.set(
          hasInitializedCurrentRecordFilterGroupsComponentFamilyState.atomFamily(
            {
              instanceId: RECORD_INDEX_ID,
              familyKey: { viewId: allCompaniesView.id },
            },
          ),
          hasInitializedFilters,
        );

        store.set(
          unsavedViewFiltersByViewIdState.atom,
          unsavedViewFiltersByViewId,
        );
      },
    }),
  });

const getUnsavedViewFiltersByViewId = () =>
  jotaiStore.get(unsavedViewFiltersByViewIdState.atom);

describe('ViewBarUnsavedFiltersPersistEffect', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('saves filters that differ from the view to session storage', () => {
    renderPersistEffect({
      currentRecordFilters: [unsavedRecordFilter],
      hasInitializedFilters: true,
    });

    expect(getUnsavedViewFiltersByViewId()).toEqual({
      [allCompaniesView.id]: {
        recordFilters: [unsavedRecordFilter],
        recordFilterGroups: [],
      },
    });

    expect(
      JSON.parse(sessionStorage.getItem('unsavedViewFiltersByViewIdState')!),
    ).toEqual(getUnsavedViewFiltersByViewId());
  });

  it('removes the saved draft once the filters match the view again', () => {
    renderPersistEffect({
      currentRecordFilters: [],
      hasInitializedFilters: true,
      unsavedViewFiltersByViewId: {
        [allCompaniesView.id]: previousUnsavedViewFilters,
      },
    });

    expect(getUnsavedViewFiltersByViewId()).toEqual({});
  });

  it('keeps the saved draft untouched until the view filters are initialized', () => {
    renderPersistEffect({
      currentRecordFilters: [],
      hasInitializedFilters: false,
      unsavedViewFiltersByViewId: {
        [allCompaniesView.id]: previousUnsavedViewFilters,
      },
    });

    expect(getUnsavedViewFiltersByViewId()).toEqual({
      [allCompaniesView.id]: previousUnsavedViewFilters,
    });
  });
});

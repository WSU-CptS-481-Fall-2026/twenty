import { act, renderHook } from '@testing-library/react';
import { type Store } from 'jotai/vanilla/store';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { currentRecordFiltersComponentState } from '@/object-record/record-filter/states/currentRecordFiltersComponentState';
import { type RecordFilter } from '@/object-record/record-filter/types/RecordFilter';
import { jotaiStore } from '@/ui/utilities/state/jotai/jotaiStore';
import { unsavedViewFiltersByViewIdState } from '@/views/states/unsavedViewFiltersByViewIdState';
import { type ViewWithRelations } from '@/views/types/ViewWithRelations';
import { useCreateViewFromCurrentState } from '@/views/view-picker/hooks/useCreateViewFromCurrentState';
import { viewPickerModeComponentState } from '@/views/view-picker/states/viewPickerModeComponentState';
import { type ViewPickerMode } from '@/views/view-picker/types/ViewPickerMode';
import { ViewFilterOperand } from 'twenty-shared/types';
import { getFilterTypeFromFieldType, isDefined } from 'twenty-shared/utils';
import { getJestMetadataAndApolloMocksAndCommandMenuWrapper } from '~/testing/jest/getJestMetadataAndApolloMocksAndCommandMenuWrapper';
import { mockedViews } from '~/testing/mock-data/generated/metadata/views/mock-views-data';
import { getTestEnrichedObjectMetadataItemsMock } from '~/testing/utils/getTestEnrichedObjectMetadataItemsMock';
import { setTestViewsInMetadataStore } from '~/testing/utils/setTestViewsInMetadataStore';

const mockCreateViewFromCurrentView = jest.fn();

jest.mock('@/views/hooks/useCreateViewFromCurrentView', () => ({
  useCreateViewFromCurrentView: () => ({
    createViewFromCurrentView: mockCreateViewFromCurrentView,
  }),
}));

const RECORD_INDEX_ID = 'recordIndexId';

const companyObjectMetadataItem = getTestEnrichedObjectMetadataItemsMock().find(
  (objectMetadataItem) => objectMetadataItem.nameSingular === 'company',
);

if (!isDefined(companyObjectMetadataItem)) {
  throw new Error('Missing mock object metadata item "company"');
}

const nameFieldMetadataItem = companyObjectMetadataItem.fields.find(
  (fieldMetadataItem) => fieldMetadataItem.name === 'name',
)!;

const allCompaniesView = {
  ...mockedViews.find((view) => view.name === 'All Companies')!,
  viewFilters: [],
  viewFilterGroups: [],
} satisfies ViewWithRelations;

const unsavedRecordFilter: RecordFilter = {
  id: 'unsaved-filter-id',
  fieldMetadataId: nameFieldMetadataItem.id,
  value: 'Acme',
  displayValue: 'Acme',
  operand: ViewFilterOperand.CONTAINS,
  label: nameFieldMetadataItem.label,
  type: getFilterTypeFromFieldType(nameFieldMetadataItem.type),
};

const currentRecordFiltersAtom = currentRecordFiltersComponentState.atomFamily({
  instanceId: RECORD_INDEX_ID,
});

const renderUseCreateViewFromCurrentState = (
  viewPickerMode: ViewPickerMode,
) => {
  const Wrapper = getJestMetadataAndApolloMocksAndCommandMenuWrapper({
    apolloMocks: [],
    componentInstanceId: 'instanceId',
    contextStoreCurrentObjectMetadataNameSingular: 'company',
    contextStoreCurrentViewId: allCompaniesView.id,
    onInitializeJotaiStore: (store: Store) => {
      setTestViewsInMetadataStore(store, [allCompaniesView]);
    },
  });

  const renderResult = renderHook(() => useCreateViewFromCurrentState(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <Wrapper>{children}</Wrapper>
      </MemoryRouter>
    ),
  });

  act(() => {
    jotaiStore.set(
      viewPickerModeComponentState.atomFamily({ instanceId: 'instanceId' }),
      viewPickerMode,
    );
    jotaiStore.set(currentRecordFiltersAtom, [unsavedRecordFilter]);
    jotaiStore.set(unsavedViewFiltersByViewIdState.atom, {
      [allCompaniesView.id]: {
        recordFilters: [unsavedRecordFilter],
        recordFilterGroups: [],
      },
    });
  });

  return renderResult;
};

describe('useCreateViewFromCurrentState', () => {
  beforeEach(() => {
    mockCreateViewFromCurrentView.mockResolvedValue('created-view-id');
  });

  afterEach(() => {
    mockCreateViewFromCurrentView.mockReset();
    sessionStorage.clear();
  });

  it('gives the source view back its saved filters once its unsaved filters are saved as a new view', async () => {
    const { result } = renderUseCreateViewFromCurrentState(
      'create-from-current',
    );

    await act(async () => {
      await result.current.createViewFromCurrentState();
    });

    expect(jotaiStore.get(currentRecordFiltersAtom)).toEqual([]);
    expect(jotaiStore.get(unsavedViewFiltersByViewIdState.atom)).toEqual({});
  });

  it('keeps the source view unsaved filters when creating an empty view', async () => {
    const { result } = renderUseCreateViewFromCurrentState('create-empty');

    await act(async () => {
      await result.current.createViewFromCurrentState();
    });

    expect(jotaiStore.get(currentRecordFiltersAtom)).toEqual([
      unsavedRecordFilter,
    ]);
    expect(jotaiStore.get(unsavedViewFiltersByViewIdState.atom)).toEqual({
      [allCompaniesView.id]: {
        recordFilters: [unsavedRecordFilter],
        recordFilterGroups: [],
      },
    });
  });
});

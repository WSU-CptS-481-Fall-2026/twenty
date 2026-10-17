import { act, renderHook } from '@testing-library/react';
import { type Store } from 'jotai/vanilla/store';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { jotaiStore } from '@/ui/utilities/state/jotai/jotaiStore';
import {
  type UnsavedViewFilters,
  unsavedViewFiltersByViewIdState,
} from '@/views/states/unsavedViewFiltersByViewIdState';
import { type ViewWithRelations } from '@/views/types/ViewWithRelations';
import { useDestroyViewFromCurrentState } from '@/views/view-picker/hooks/useDestroyViewFromCurrentState';
import { viewPickerReferenceViewIdComponentState } from '@/views/view-picker/states/viewPickerReferenceViewIdComponentState';
import { getJestMetadataAndApolloMocksAndCommandMenuWrapper } from '~/testing/jest/getJestMetadataAndApolloMocksAndCommandMenuWrapper';
import { mockedViews } from '~/testing/mock-data/generated/metadata/views/mock-views-data';
import { setTestViewsInMetadataStore } from '~/testing/utils/setTestViewsInMetadataStore';

const mockPerformViewApiDestroy = jest.fn();

jest.mock('@/views/hooks/internal/usePerformViewApiPersist', () => ({
  usePerformViewApiPersist: () => ({
    performViewApiDestroy: mockPerformViewApiDestroy,
  }),
}));

const allCompaniesView = mockedViews.find(
  (view) => view.name === 'All Companies',
)!;

const viewToDestroy = {
  ...allCompaniesView,
  id: 'view-to-destroy-id',
  name: 'View to destroy',
  key: null,
  viewFields: [],
  viewFilters: [],
  viewFilterGroups: [],
  viewSorts: [],
  viewGroups: [],
} satisfies ViewWithRelations;

const unsavedViewFilters: UnsavedViewFilters = {
  recordFilters: [],
  recordFilterGroups: [],
};

const renderUseDestroyViewFromCurrentState = () => {
  const Wrapper = getJestMetadataAndApolloMocksAndCommandMenuWrapper({
    apolloMocks: [],
    componentInstanceId: 'instanceId',
    contextStoreCurrentObjectMetadataNameSingular: 'company',
    contextStoreCurrentViewId: allCompaniesView.id,
    onInitializeJotaiStore: (store: Store) => {
      setTestViewsInMetadataStore(store, [allCompaniesView, viewToDestroy]);
    },
  });

  const renderResult = renderHook(() => useDestroyViewFromCurrentState(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <Wrapper>{children}</Wrapper>
      </MemoryRouter>
    ),
  });

  act(() => {
    jotaiStore.set(
      viewPickerReferenceViewIdComponentState.atomFamily({
        instanceId: 'instanceId',
      }),
      viewToDestroy.id,
    );
    jotaiStore.set(unsavedViewFiltersByViewIdState.atom, {
      [allCompaniesView.id]: unsavedViewFilters,
      [viewToDestroy.id]: unsavedViewFilters,
    });
  });

  return renderResult;
};

describe('useDestroyViewFromCurrentState', () => {
  afterEach(() => {
    mockPerformViewApiDestroy.mockReset();
    sessionStorage.clear();
  });

  it('forgets the unsaved filters of a view once it is destroyed', async () => {
    mockPerformViewApiDestroy.mockResolvedValue({ status: 'successful' });

    const { result } = renderUseDestroyViewFromCurrentState();

    await act(async () => {
      await result.current.destroyViewFromCurrentState();
    });

    expect(mockPerformViewApiDestroy).toHaveBeenCalledWith({
      id: viewToDestroy.id,
    });
    expect(jotaiStore.get(unsavedViewFiltersByViewIdState.atom)).toEqual({
      [allCompaniesView.id]: unsavedViewFilters,
    });
  });

  it('keeps the unsaved filters of a view when destroying it fails', async () => {
    mockPerformViewApiDestroy.mockResolvedValue({ status: 'failed' });

    const { result } = renderUseDestroyViewFromCurrentState();

    await act(async () => {
      await result.current.destroyViewFromCurrentState();
    });

    expect(jotaiStore.get(unsavedViewFiltersByViewIdState.atom)).toEqual({
      [allCompaniesView.id]: unsavedViewFilters,
      [viewToDestroy.id]: unsavedViewFilters,
    });
  });
});

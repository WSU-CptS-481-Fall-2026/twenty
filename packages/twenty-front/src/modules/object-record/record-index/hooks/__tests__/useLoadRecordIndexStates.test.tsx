import { renderHook } from '@testing-library/react';

import { useLoadRecordIndexStates } from '@/object-record/record-index/hooks/useLoadRecordIndexStates';
import { anyFieldFilterValueComponentState } from '@/object-record/record-filter/states/anyFieldFilterValueComponentState';
import { currentRecordFiltersComponentState } from '@/object-record/record-filter/states/currentRecordFiltersComponentState';
import { type RecordFilter } from '@/object-record/record-filter/types/RecordFilter';
import { jotaiStore } from '@/ui/utilities/state/jotai/jotaiStore';
import { unsavedViewFiltersByViewIdState } from '@/views/states/unsavedViewFiltersByViewIdState';
import { type View } from '@/views/types/View';
import { act } from 'react';
import { ViewFilterOperand } from 'twenty-shared/types';
import { getFilterTypeFromFieldType } from 'twenty-shared/utils';
import { ViewType, ViewVisibility } from '~/generated-metadata/graphql';
import { getJestMetadataAndApolloMocksWrapper } from '~/testing/jest/getJestMetadataAndApolloMocksWrapper';
import { getMockObjectMetadataItemOrThrow } from '~/testing/utils/getMockObjectMetadataItemOrThrow';

const recordIndexId = 'record-table-widget-record-index-id';
const ambientViewInstanceId = 'instanceId';
const objectMetadataItem = getMockObjectMetadataItemOrThrow('company');

const makeView = (anyFieldFilterValue: string | null): View => ({
  id: 'view-id',
  name: 'Widget view',
  type: ViewType.TABLE,
  objectMetadataId: objectMetadataItem.id,
  isCompact: false,
  viewFields: [],
  viewGroups: [],
  viewFilters: [],
  viewFilterGroups: [],
  viewSorts: [],
  shouldHideEmptyGroups: false,
  position: 0,
  icon: 'IconTable',
  anyFieldFilterValue,
  visibility: ViewVisibility.WORKSPACE,
  isActive: true,
});

const renderUseLoadRecordIndexStates = () =>
  renderHook(() => useLoadRecordIndexStates(), {
    wrapper: getJestMetadataAndApolloMocksWrapper({
      apolloMocks: [],
      objectMetadataItems: [objectMetadataItem],
    }),
  });

describe('useLoadRecordIndexStates', () => {
  it('hydrates the scoped any-field filter from the loaded view', () => {
    const { result } = renderUseLoadRecordIndexStates();

    act(() => {
      result.current.loadRecordIndexStates(
        makeView('Acme'),
        objectMetadataItem,
        {
          skipGlobalIndexStates: true,
          recordIndexId,
        },
      );
    });

    expect(
      jotaiStore.get(
        anyFieldFilterValueComponentState.atomFamily({
          instanceId: recordIndexId,
        }),
      ),
    ).toBe('Acme');
  });

  it('clears a stale scoped any-field filter when the loaded view has none', () => {
    const anyFieldFilterValueAtom =
      anyFieldFilterValueComponentState.atomFamily({
        instanceId: recordIndexId,
      });

    const { result } = renderUseLoadRecordIndexStates();

    act(() => {
      jotaiStore.set(anyFieldFilterValueAtom, 'stale value');
      result.current.loadRecordIndexStates(makeView(null), objectMetadataItem, {
        skipGlobalIndexStates: true,
        recordIndexId,
      });
    });

    expect(jotaiStore.get(anyFieldFilterValueAtom)).toBe('');
  });

  describe('with unsaved filters for the view', () => {
    const nameFieldMetadataItem = objectMetadataItem.fields.find(
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

    const renderWithUnsavedViewFilters = () => {
      const renderResult = renderUseLoadRecordIndexStates();

      act(() => {
        jotaiStore.set(unsavedViewFiltersByViewIdState.atom, {
          'view-id': {
            recordFilters: [unsavedRecordFilter],
            recordFilterGroups: [],
          },
        });
      });

      return renderResult;
    };

    afterEach(() => {
      jotaiStore.set(unsavedViewFiltersByViewIdState.atom, {});
      sessionStorage.clear();
    });

    it('restores them instead of the saved view filters', () => {
      const { result } = renderWithUnsavedViewFilters();

      act(() => {
        result.current.loadRecordIndexStates(
          makeView(null),
          objectMetadataItem,
        );
      });

      expect(
        jotaiStore.get(
          currentRecordFiltersComponentState.atomFamily({
            instanceId: ambientViewInstanceId,
          }),
        ),
      ).toEqual([unsavedRecordFilter]);
    });

    it('ignores them when loading an embedded view with its own record index id', () => {
      const { result } = renderWithUnsavedViewFilters();

      act(() => {
        result.current.loadRecordIndexStates(
          makeView(null),
          objectMetadataItem,
          {
            skipGlobalIndexStates: true,
            recordIndexId,
          },
        );
      });

      expect(
        jotaiStore.get(
          currentRecordFiltersComponentState.atomFamily({
            instanceId: recordIndexId,
          }),
        ),
      ).toEqual([]);
    });
  });
});

import { type RecordFilter } from '@/object-record/record-filter/types/RecordFilter';
import { type RecordFilterGroup } from '@/object-record/record-filter-group/types/RecordFilterGroup';
import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export type UnsavedViewFilters = {
  recordFilters: RecordFilter[];
  recordFilterGroups: RecordFilterGroup[];
};

export const unsavedViewFiltersByViewIdState = createAtomState<
  Record<string, UnsavedViewFilters>
>({
  key: 'unsavedViewFiltersByViewIdState',
  defaultValue: {},
  useSessionStorage: true,
});

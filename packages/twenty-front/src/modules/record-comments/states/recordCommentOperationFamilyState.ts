import { type recordCommentDraftFamilyState } from '@/record-comments/states/recordCommentDraftFamilyState';
import { createAtomFamilyState } from '@/ui/utilities/state/jotai/utils/createAtomFamilyState';

export const recordCommentOperationFamilyState = createAtomFamilyState<
  'idle' | 'posting' | 'deleting' | 'loadingMore',
  Parameters<typeof recordCommentDraftFamilyState>[0]
>({
  key: 'recordCommentOperationFamilyState',
  defaultValue: 'idle',
});

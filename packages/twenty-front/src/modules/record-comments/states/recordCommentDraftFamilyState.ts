import { createJSONStorage } from 'jotai/utils';

import { createAtomFamilyState } from '@/ui/utilities/state/jotai/utils/createAtomFamilyState';
import { type RecordCommentMentionInput } from '~/generated/graphql';

export type RecordCommentDraft = {
  id: string;
  body: string;
  mentions?: RecordCommentMentionInput[];
} | null;

const draftStorage = createJSONStorage<RecordCommentDraft>(
  () => sessionStorage,
);

export const recordCommentDraftFamilyState = createAtomFamilyState<
  RecordCommentDraft,
  {
    workspaceId: string;
    workspaceMemberId: string;
    objectMetadataId: string;
    recordId: string;
  }
>({
  key: 'recordCommentDraftFamilyState',
  defaultValue: null,
  storage: {
    getItem: draftStorage.getItem,
    setItem: draftStorage.setItem,
    removeItem: draftStorage.removeItem,
  },
});

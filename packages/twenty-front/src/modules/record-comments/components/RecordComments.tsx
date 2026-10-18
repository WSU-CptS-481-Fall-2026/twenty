import { isNonEmptyString } from '@sniptt/guards';
import { useMutation, useQuery } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useId, useRef, useState } from 'react';
import { useStore } from 'jotai';
import { v4 as uuidv4 } from 'uuid';
import { Avatar } from 'twenty-ui/data-display';
import {
  IconArrowBackUp,
  IconArrowUp,
  IconMessageCircle,
  IconTrash,
} from 'twenty-ui/icon';
import { Button, LightIconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { isDefined } from 'twenty-shared/utils';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { currentWorkspaceMembersState } from '@/auth/states/currentWorkspaceMembersState';
import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { RECORD_COMMENTS_PAGE_SIZE } from '@/record-comments/constants/RecordCommentsPageSize';
import {
  CREATE_RECORD_COMMENT,
  DELETE_RECORD_COMMENT,
  RECORD_COMMENTS,
} from '@/record-comments/graphql/recordComments';
import { recordCommentDraftFamilyState } from '@/record-comments/states/recordCommentDraftFamilyState';
import { recordCommentOperationFamilyState } from '@/record-comments/states/recordCommentOperationFamilyState';
import { RecordCommentInput } from '@/record-comments/components/RecordCommentInput';
import { RecordCommentBody } from '@/record-comments/components/RecordCommentBody';
import { type TargetRecordIdentifier } from '@/ui/layout/contexts/TargetRecordIdentifier';
import { ConfirmationModal } from '@/ui/layout/modal/components/ConfirmationModal';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { useAtomFamilyState } from '@/ui/utilities/state/jotai/hooks/useAtomFamilyState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { dateLocaleState } from '~/localization/states/dateLocaleState';
import { beautifyPastDateRelativeToNow } from '~/utils/date-utils';
import {
  type CreateRecordCommentMutation,
  type CreateRecordCommentMutationVariables,
  type DeleteRecordCommentMutation,
  type DeleteRecordCommentMutationVariables,
  type RecordCommentsQuery,
  type RecordCommentsQueryVariables,
} from '~/generated/graphql';

const MAX_RECORD_COMMENT_LENGTH = 5000;

const StyledSection = styled.section`
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  margin: 0 auto;
  max-width: 760px;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[5]}
    ${themeCssVariables.spacing[4]};
  width: 100%;
`;

const StyledComment = styled.article`
  align-items: flex-start;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[3]} 0;

  & + article {
    border-top: 1px solid ${themeCssVariables.border.color.light};
  }
`;

const StyledCommentContent = styled.div`
  flex: 1;
  min-width: 0;
`;

const StyledByline = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  font-size: ${themeCssVariables.font.size.md};
  gap: ${themeCssVariables.spacing[2]};
  min-height: ${themeCssVariables.spacing[6]};
  strong {
    font-weight: ${themeCssVariables.font.weight.medium};
  }
  time {
    color: ${themeCssVariables.font.color.tertiary};
    font-size: ${themeCssVariables.font.size.sm};
  }
`;

const StyledBody = styled.p`
  line-height: 1.5;
  margin: ${themeCssVariables.spacing[1]} 0 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;

const StyledComposer = styled.div`
  align-items: flex-start;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  margin-bottom: ${themeCssVariables.spacing[5]};
`;

const StyledReply = styled.div`
  margin-top: ${themeCssVariables.spacing[1]};
`;

const StyledEditor = styled.form`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: block;
  flex: 1;
  min-width: 0;
  padding: ${themeCssVariables.spacing[3]};
  transition: border-color 0.15s;

  &:focus-within {
    border-color: ${themeCssVariables.color.blue};
    box-shadow: 0 0 0 3px ${themeCssVariables.color.transparent.blue2};
  }

  label {
    border: 0;
    clip-path: inset(50%);
    height: 1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
`;

const StyledComposerFooter = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  margin-top: ${themeCssVariables.spacing[3]};
`;

const StyledCaption = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledFeedHeader = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  justify-content: space-between;
  padding-bottom: ${themeCssVariables.spacing[2]};
`;

const StyledFeedback = styled.div`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.secondary};
  line-height: 1.5;
  margin-bottom: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledEmpty = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[4]} 0;
  p {
    margin: 0;
  }
`;

const StyledPagination = styled.div`
  display: flex;
  justify-content: center;
  padding-top: ${themeCssVariables.spacing[3]};
`;

type RecordCommentsProps = { targetRecordIdentifier: TargetRecordIdentifier };

export const RecordComments = ({
  targetRecordIdentifier,
}: RecordCommentsProps) => {
  const deleteCommentModalId = useId();
  const { openModal } = useModal();
  const client = useApolloCoreClient();
  const currentWorkspace = useAtomStateValue(currentWorkspaceState);
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const currentWorkspaceMembers = useAtomStateValue(
    currentWorkspaceMembersState,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { localeCatalog } = useAtomStateValue(dateLocaleState);
  const currentAuthorName =
    `${currentWorkspaceMember?.name?.firstName ?? ''} ${currentWorkspaceMember?.name?.lastName ?? ''}`.trim();
  const store = useStore();
  const { objectMetadataItem } = useObjectMetadataItem({
    objectNameSingular: targetRecordIdentifier.targetObjectNameSingular,
  });
  const target = {
    objectMetadataId: objectMetadataItem.id,
    recordId: targetRecordIdentifier.id,
  };
  const queryVariables = {
    input: { ...target, pageSize: RECORD_COMMENTS_PAGE_SIZE },
  };
  const scope = {
    workspaceId: currentWorkspace?.id ?? '',
    workspaceMemberId: currentWorkspaceMember?.id ?? '',
    ...target,
  };
  const [draft, setDraft] = useAtomFamilyState(
    recordCommentDraftFamilyState,
    scope,
  );
  const [operation, setOperation] = useAtomFamilyState(
    recordCommentOperationFamilyState,
    scope,
  );
  const operationAtom = recordCommentOperationFamilyState.atomFamily(scope);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const { data, loading, error, fetchMore, refetch } = useQuery<
    RecordCommentsQuery,
    RecordCommentsQueryVariables
  >(RECORD_COMMENTS, {
    client,
    variables: queryVariables,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  });
  const [createComment] = useMutation<
    CreateRecordCommentMutation,
    CreateRecordCommentMutationVariables
  >(CREATE_RECORD_COMMENT, { client });
  const [deleteComment] = useMutation<
    DeleteRecordCommentMutation,
    DeleteRecordCommentMutationVariables
  >(DELETE_RECORD_COMMENT, { client });
  const comments = data?.recordComments.comments ?? [];
  const cursor = data?.recordComments.nextCursor;
  const body = draft?.body ?? '';
  const mentions = draft?.mentions ?? [];
  const isBusy = operation !== 'idle';

  const replyToComment = (authorWorkspaceMemberId: string) => {
    if (store.get(operationAtom) !== 'idle' || loading) {
      return;
    }
    const member = currentWorkspaceMembers.find(
      (candidate) => candidate.id === authorWorkspaceMemberId,
    );
    if (
      isDefined(member) &&
      !mentions.some((mention) => mention.workspaceMemberId === member.id)
    ) {
      const label = [member.name.firstName, member.name.lastName]
        .filter(isNonEmptyString)
        .join(' ');
      const prefix = `@${label} `;
      setDraft({
        id: uuidv4(),
        body: prefix + body,
        mentions: [
          { workspaceMemberId: member.id, start: 0, end: prefix.length - 1 },
          ...mentions.map((mention) => ({
            ...mention,
            start: mention.start + prefix.length,
            end: mention.end + prefix.length,
          })),
        ],
      });
      setErrorMessage(null);
    }
    requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
      input?.scrollIntoView({ block: 'nearest' });
    });
  };

  const postComment = async () => {
    if (
      store.get(operationAtom) !== 'idle' ||
      !isDefined(draft) ||
      !body.trim() ||
      body.length > MAX_RECORD_COMMENT_LENGTH
    ) {
      return;
    }
    setOperation('posting');
    setErrorMessage(null);
    try {
      await createComment({
        variables: {
          input: {
            ...target,
            id: draft.id,
            body,
            ...(mentions.length > 0 ? { mentions } : {}),
          },
        },
      });
      setDraft(null);
    } catch {
      setErrorMessage(
        t`Could not post your comment. Your draft is saved. Check your connection and record access, then try again.`,
      );
      return;
    } finally {
      setOperation('idle');
    }
    await refetch().catch(() =>
      setErrorMessage(
        t`Your comment was posted, but comments could not refresh. Reload to see it.`,
      ),
    );
  };

  const removeComment = async (commentId: string) => {
    if (store.get(operationAtom) !== 'idle') {
      return;
    }
    setOperation('deleting');
    setErrorMessage(null);
    try {
      await deleteComment({ variables: { input: { ...target, commentId } } });
    } catch {
      setErrorMessage(
        t`Could not delete this comment. Check your connection and permissions, then try again.`,
      );
      return;
    } finally {
      setOperation('idle');
    }
    await refetch().catch(() =>
      setErrorMessage(
        t`The comment was deleted, but comments could not refresh. Reload to see the change.`,
      ),
    );
  };

  const loadMore = async () => {
    if (store.get(operationAtom) !== 'idle' || !isDefined(cursor)) {
      return;
    }
    setOperation('loadingMore');
    setErrorMessage(null);
    try {
      await fetchMore({
        variables: {
          input: {
            ...queryVariables.input,
            cursor: { id: cursor.id, createdAt: cursor.createdAt },
          },
        },
        updateQuery: (previous, { fetchMoreResult }) => ({
          recordComments: {
            ...fetchMoreResult.recordComments,
            comments: Array.from(
              new Map(
                [
                  ...previous.recordComments.comments,
                  ...fetchMoreResult.recordComments.comments,
                ].map((comment) => [comment.id, comment]),
              ).values(),
            ),
          },
        }),
      });
    } catch {
      setErrorMessage(t`Could not load older comments. Try again.`);
    } finally {
      setOperation('idle');
    }
  };

  return (
    <StyledSection aria-label={t`Comments`}>
      {isDefined(errorMessage) && (
        <StyledFeedback role="alert">{errorMessage}</StyledFeedback>
      )}
      {isDefined(error) ? (
        <StyledFeedback role="alert">
          <p>{t`Comments are unavailable. Check your connection and access to this record.`}</p>
          <Button
            title={t`Retry`}
            variant="secondary"
            onClick={() => {
              void refetch().catch(() => undefined);
            }}
          />
        </StyledFeedback>
      ) : (
        <>
          <StyledComposer>
            <Avatar
              name={currentAuthorName}
              colorSeed={currentWorkspaceMember?.id}
              size="lg"
              shape="circle"
            />
            <StyledEditor
              onSubmit={(event) => {
                event.preventDefault();
                void postComment();
              }}
            >
              <RecordCommentInput
                textAreaRef={inputRef}
                recordId={target.recordId}
                body={body}
                mentions={mentions}
                disabled={isBusy || loading}
                onChange={(value) => {
                  setDraft({ id: uuidv4(), ...value });
                  setErrorMessage(null);
                }}
              />
              <StyledComposerFooter>
                <StyledCaption>
                  {body.trim()
                    ? t`Draft saved in this tab`
                    : t`Visible to people with record access`}
                </StyledCaption>
                {body.length > MAX_RECORD_COMMENT_LENGTH && (
                  <span role="alert">{t`Comments can contain up to 5000 characters.`}</span>
                )}
                <Button
                  title={
                    operation === 'posting' ? t`Posting...` : t`Post comment`
                  }
                  ariaLabel={
                    operation === 'posting' ? t`Posting...` : t`Post comment`
                  }
                  Icon={IconArrowUp}
                  type="submit"
                  size="small"
                  variant="primary"
                  disabled={
                    isBusy ||
                    loading ||
                    !body.trim() ||
                    body.length > MAX_RECORD_COMMENT_LENGTH
                  }
                />
              </StyledComposerFooter>
            </StyledEditor>
          </StyledComposer>
          {loading && comments.length === 0 && (
            <p role="status">{t`Loading comments...`}</p>
          )}
          {!loading && comments.length === 0 && (
            <StyledEmpty>
              <IconMessageCircle size={24} aria-hidden />
              <p>{t`No comments yet. Share the first update.`}</p>
            </StyledEmpty>
          )}
          {comments.length > 0 && (
            <StyledFeedHeader>
              <span>{t`Latest comments`}</span>
              <span>{t`Newest first`}</span>
            </StyledFeedHeader>
          )}
          {comments.map((comment) => (
            <StyledComment
              key={comment.id}
              aria-label={t`Comment by ${comment.authorName}`}
            >
              <Avatar
                name={comment.authorName}
                colorSeed={comment.authorWorkspaceMemberId}
                size="lg"
                shape="circle"
              />
              <StyledCommentContent>
                <StyledByline>
                  <strong>{comment.authorName}</strong>
                  <time
                    dateTime={comment.createdAt}
                    title={new Date(comment.createdAt).toLocaleString()}
                  >
                    {beautifyPastDateRelativeToNow(
                      comment.createdAt,
                      localeCatalog,
                    )}
                  </time>
                </StyledByline>
                <StyledBody>
                  <RecordCommentBody comment={comment} />
                </StyledBody>
                <StyledReply>
                  <Button
                    title={t`Reply`}
                    ariaLabel={t`Reply to ${comment.authorName}`}
                    Icon={IconArrowBackUp}
                    variant="tertiary"
                    size="small"
                    disabled={isBusy || loading}
                    onClick={() =>
                      replyToComment(comment.authorWorkspaceMemberId)
                    }
                  />
                </StyledReply>
              </StyledCommentContent>
              {comment.canDelete && (
                <LightIconButton
                  title={t`Delete comment`}
                  aria-label={t`Delete comment`}
                  Icon={IconTrash}
                  accent="tertiary"
                  disabled={isBusy}
                  onClick={() => {
                    setConfirmDeleteId(comment.id);
                    openModal(deleteCommentModalId);
                  }}
                />
              )}
            </StyledComment>
          ))}
          {isDefined(cursor) && (
            <StyledPagination>
              <Button
                title={
                  operation === 'loadingMore'
                    ? t`Loading...`
                    : t`Load older comments`
                }
                variant="tertiary"
                disabled={isBusy || loading}
                onClick={() => {
                  void loadMore();
                }}
              />
            </StyledPagination>
          )}
        </>
      )}
      {isDefined(confirmDeleteId) && (
        <ConfirmationModal
          modalInstanceId={deleteCommentModalId}
          title={t`Delete comment`}
          subtitle={t`This comment will be permanently deleted. This action cannot be undone.`}
          confirmButtonText={t`Delete`}
          confirmButtonAccent="danger"
          loading={isBusy}
          onClose={() => setConfirmDeleteId(null)}
          onConfirmClick={() => {
            setConfirmDeleteId(null);
            void removeComment(confirmDeleteId);
          }}
        />
      )}
    </StyledSection>
  );
};

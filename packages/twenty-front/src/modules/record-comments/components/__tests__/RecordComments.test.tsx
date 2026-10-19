import { type MockedResponse } from '@apollo/client/testing';
import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { v4 as uuidv4 } from 'uuid';

import { RecordComments } from '@/record-comments/components/RecordComments';
import { RECORD_COMMENTS_PAGE_SIZE } from '@/record-comments/constants/RecordCommentsPageSize';
import {
  CREATE_RECORD_COMMENT,
  DELETE_RECORD_COMMENT,
  RECORD_COMMENTS,
} from '@/record-comments/graphql/recordComments';
import {
  type CreateRecordCommentMutation,
  type CreateRecordCommentMutationVariables,
  type DeleteRecordCommentMutation,
  type DeleteRecordCommentMutationVariables,
  type RecordCommentsQuery,
  type RecordCommentsQueryVariables,
} from '~/generated/graphql';

jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: () => ({ objectMetadataItem: { id: 'object-id' } }),
}));
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: (state: { key: string }) =>
    state.key === 'currentWorkspaceMembersState'
      ? [{ id: 'jony-id', name: { firstName: 'Jony', lastName: 'Ive' } }]
      : { id: 'member-id' },
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'submission-id') }));

const mockSubmissionId = jest.mocked<() => string>(uuidv4);
jest.mock('@/record-comments/constants/RecordCommentsPageSize', () => ({
  RECORD_COMMENTS_PAGE_SIZE: 2,
}));

const target = { objectMetadataId: 'object-id', recordId: 'record-id' };
const emptyComments: MockedResponse<
  RecordCommentsQuery,
  RecordCommentsQueryVariables
> = {
  request: {
    query: RECORD_COMMENTS,
    variables: { input: { ...target, pageSize: RECORD_COMMENTS_PAGE_SIZE } },
  },
  result: { data: { recordComments: { comments: [], nextCursor: null } } },
  maxUsageCount: 5,
};
const input = { ...target, id: 'submission-id', body: 'Follow up on Friday' };

const renderComments = (
  mutations: MockedResponse[] = [],
  comments: MockedResponse = emptyComments,
) =>
  render(
    <I18nProvider i18n={i18n}>
      <Provider store={createStore()}>
        <MockedProvider mocks={[comments, ...mutations]}>
          <RecordComments
            targetRecordIdentifier={{
              id: target.recordId,
              targetObjectNameSingular: 'company',
            }}
          />
        </MockedProvider>
      </Provider>
    </I18nProvider>,
  );

describe('RecordComments', () => {
  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });
  beforeEach(() => {
    sessionStorage.clear();
    mockSubmissionId.mockReturnValue('submission-id');
  });

  it('uses the standard confirmation modal to cancel or confirm deleting a comment', async () => {
    const user = userEvent.setup();
    const ownComment = {
      id: 'own-comment',
      body: 'My update',
      mentions: [],
      authorName: 'Test Member',
      authorWorkspaceMemberId: 'member-id',
      createdAt: '2026-10-16T12:00:00Z',
      canDelete: true,
    };
    const firstPage: MockedResponse<
      RecordCommentsQuery,
      RecordCommentsQueryVariables
    > = {
      ...emptyComments,
      maxUsageCount: 1,
      result: {
        data: { recordComments: { comments: [ownComment], nextCursor: null } },
      },
    };
    const deletion: MockedResponse<
      DeleteRecordCommentMutation,
      DeleteRecordCommentMutationVariables
    > = {
      request: {
        query: DELETE_RECORD_COMMENT,
        variables: { input: { ...target, commentId: ownComment.id } },
      },
      result: { data: { deleteRecordComment: true } },
    };
    renderComments([deletion, emptyComments], firstPage);

    await user.click(
      await screen.findByRole('button', { name: 'Delete comment' }),
    );
    let dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'This comment will be permanently deleted. This action cannot be undone.',
      ),
    ).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: /^Cancel/ }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByText(ownComment.body)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Delete comment' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByText(ownComment.body)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Delete comment' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Delete/ }));
    await screen.findByText('No comments yet. Share the first update.');
    expect(screen.queryByText(ownComment.body)).not.toBeInTheDocument();
  });

  it('keeps the configured page size and existing comments when loading older comments', async () => {
    const user = userEvent.setup();
    const cursor = { id: 'second-comment', createdAt: '2026-10-16T11:00:00Z' };
    const firstComment = {
      id: 'first-comment',
      body: 'First update',
      mentions: [],
      authorName: 'Jony Ive',
      authorWorkspaceMemberId: 'jony-id',
      createdAt: '2026-10-16T12:00:00Z',
      canDelete: false,
    };
    const secondComment = {
      ...firstComment,
      ...cursor,
      body: 'Second update',
    };
    const firstPage: MockedResponse<
      RecordCommentsQuery,
      RecordCommentsQueryVariables
    > = {
      ...emptyComments,
      result: {
        data: {
          recordComments: {
            comments: [firstComment, secondComment],
            nextCursor: cursor,
          },
        },
      },
    };
    const nextPage: MockedResponse<
      RecordCommentsQuery,
      RecordCommentsQueryVariables
    > = {
      request: {
        query: RECORD_COMMENTS,
        variables: {
          input: { ...target, pageSize: RECORD_COMMENTS_PAGE_SIZE, cursor },
        },
      },
      result: {
        data: {
          recordComments: {
            comments: [
              secondComment,
              {
                ...firstComment,
                id: 'third-comment',
                body: 'Older update',
                createdAt: '2026-10-16T10:00:00Z',
              },
            ],
            nextCursor: null,
          },
        },
      },
    };

    renderComments([nextPage], firstPage);
    await screen.findByText('First update');
    await user.click(
      screen.getByRole('button', { name: /^Load older comments/ }),
    );

    expect(await screen.findByText('Older update')).toBeVisible();
    expect(screen.getByText('First update')).toBeVisible();
    expect(screen.getAllByText('Second update')).toHaveLength(1);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(
      screen.queryByRole('button', { name: /^Load older comments/ }),
    ).not.toBeInTheDocument();
  });

  const commentsWithAuthor: MockedResponse<
    RecordCommentsQuery,
    RecordCommentsQueryVariables
  > = {
    ...emptyComments,
    result: {
      data: {
        recordComments: {
          comments: [
            {
              id: 'comment-id',
              body: 'Please confirm the plan.',
              mentions: [],
              authorName: 'Jony Ive',
              authorWorkspaceMemberId: 'jony-id',
              createdAt: '2026-10-16T12:00:00Z',
              canDelete: false,
            },
          ],
          nextCursor: null,
        },
      },
    },
  };

  it('focuses a reply with an author mention and posts the stable member reference', async () => {
    const user = userEvent.setup();
    const replyInput = {
      ...target,
      id: 'submission-id',
      body: '@Jony Ive Confirmed.',
      mentions: [{ workspaceMemberId: 'jony-id', start: 0, end: 9 }],
    };
    renderComments(
      [
        {
          request: {
            query: CREATE_RECORD_COMMENT,
            variables: { input: replyInput },
          },
          error: new Error('Connection lost'),
        },
      ],
      commentsWithAuthor,
    );
    await user.click(
      await screen.findByRole('button', { name: 'Reply to Jony Ive' }),
    );
    const input = screen.getByRole('textbox', { name: 'Write a comment' });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue('@Jony Ive ');
    await user.type(input, 'Confirmed.');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your draft is saved',
    );
    expect(input).toHaveValue(replyInput.body);
  });

  it('preserves an existing draft and does not duplicate the reply recipient', async () => {
    const user = userEvent.setup();
    renderComments([], commentsWithAuthor);
    const reply = await screen.findByRole('button', {
      name: 'Reply to Jony Ive',
    });
    const input = screen.getByRole('textbox');
    await user.type(input, 'Existing draft');
    await user.click(reply);
    expect(input).toHaveValue('@Jony Ive Existing draft');
    await user.click(reply);
    expect(input).toHaveValue('@Jony Ive Existing draft');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('focuses the draft without inventing a mention for an unavailable member', async () => {
    const user = userEvent.setup();
    const unavailableAuthor = {
      ...commentsWithAuthor,
      result: {
        data: {
          recordComments: {
            comments: [
              {
                id: 'old-comment',
                body: 'Earlier update',
                mentions: [],
                authorName: 'Former Member',
                authorWorkspaceMemberId: 'removed-id',
                createdAt: '2026-10-16T12:00:00Z',
                canDelete: false,
              },
            ],
            nextCursor: null,
          },
        },
      },
    };
    renderComments([], unavailableAuthor);
    await user.click(
      await screen.findByRole('button', { name: 'Reply to Former Member' }),
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('prevents blank submissions', async () => {
    const user = userEvent.setup();
    renderComments();
    await screen.findByText('No comments yet. Share the first update.');
    await user.type(
      screen.getByRole('textbox', { name: 'Write a comment' }),
      '   ',
    );
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeDisabled();
  });

  it('keeps the draft after a failed post and retries the same submission', async () => {
    const user = userEvent.setup();
    const failedPost: MockedResponse<
      CreateRecordCommentMutation,
      CreateRecordCommentMutationVariables
    > = {
      request: { query: CREATE_RECORD_COMMENT, variables: { input } },
      error: new Error('Connection lost'),
    };
    const savedPost: MockedResponse<
      CreateRecordCommentMutation,
      CreateRecordCommentMutationVariables
    > = {
      request: { query: CREATE_RECORD_COMMENT, variables: { input } },
      result: {
        data: {
          createRecordComment: {
            id: input.id,
            body: input.body,
            mentions: [],
            authorName: 'Test Member',
            authorWorkspaceMemberId: 'member-id',
            createdAt: '2026-10-16T12:00:00Z',
            canDelete: true,
          },
        },
      },
    };
    renderComments([failedPost, savedPost]);
    await screen.findByText('No comments yet. Share the first update.');
    await user.type(
      screen.getByRole('textbox', { name: 'Write a comment' }),
      input.body,
    );
    mockSubmissionId.mockReturnValue('another-submission-id');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your draft is saved',
    );
    expect(screen.getByRole('textbox')).toHaveValue(input.body);
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });

  it('blocks another post while the first request is pending', async () => {
    const user = userEvent.setup();
    const mutation: MockedResponse<
      CreateRecordCommentMutation,
      CreateRecordCommentMutationVariables
    > = {
      request: { query: CREATE_RECORD_COMMENT, variables: { input } },
      delay: 500,
      error: new Error('Connection lost'),
    };
    renderComments([mutation]);
    await screen.findByText('No comments yet. Share the first update.');
    await user.type(screen.getByRole('textbox'), input.body);
    await user.dblClick(screen.getByRole('button', { name: 'Post comment' }));
    expect(screen.getByRole('button', { name: 'Posting...' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
    await screen.findByRole('alert');
  });

  it('restores an unsent draft after the component remounts', async () => {
    const user = userEvent.setup();
    const first = renderComments();
    await screen.findByText('No comments yet. Share the first update.');
    await user.type(screen.getByRole('textbox'), input.body);
    first.unmount();
    renderComments();
    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveValue(input.body),
    );
  });
});

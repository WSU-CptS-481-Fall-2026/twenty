import { gql } from '@apollo/client';

export const RECORD_COMMENTS = gql`
  query RecordComments($input: RecordCommentsInput!) {
    recordComments(input: $input) {
      comments {
        id
        body
        mentions {
          workspaceMemberId
          label
          start
          end
        }
        authorName
        authorWorkspaceMemberId
        createdAt
        canDelete
      }
      nextCursor {
        id
        createdAt
      }
    }
  }
`;

export const CREATE_RECORD_COMMENT = gql`
  mutation CreateRecordComment($input: CreateRecordCommentInput!) {
    createRecordComment(input: $input) {
      id
      body
      mentions {
        workspaceMemberId
        label
        start
        end
      }
      authorName
      authorWorkspaceMemberId
      createdAt
      canDelete
    }
  }
`;

export const DELETE_RECORD_COMMENT = gql`
  mutation DeleteRecordComment($input: DeleteRecordCommentInput!) {
    deleteRecordComment(input: $input)
  }
`;

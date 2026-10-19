import { styled } from '@linaria/react';
import { Fragment } from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type RecordCommentsQuery } from '~/generated/graphql';

const StyledMention = styled.mark`
  background: ${themeCssVariables.color.transparent.blue2};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.color.blue};
  padding: 0 ${themeCssVariables.spacing[1]};
`;

type RecordCommentBodyProps = {
  comment: Pick<
    RecordCommentsQuery['recordComments']['comments'][number],
    'body' | 'mentions'
  >;
};

export const RecordCommentBody = ({ comment }: RecordCommentBodyProps) => (
  <>
    {comment.mentions.map((mention, index) => (
      <Fragment key={`${mention.start}-${mention.workspaceMemberId}`}>
        {comment.body.slice(
          index === 0 ? 0 : comment.mentions[index - 1].end,
          mention.start,
        )}
        <StyledMention data-workspace-member-id={mention.workspaceMemberId}>
          {comment.body.slice(mention.start, mention.end)}
        </StyledMention>
      </Fragment>
    ))}
    {comment.body.slice(comment.mentions.at(-1)?.end ?? 0)}
  </>
);

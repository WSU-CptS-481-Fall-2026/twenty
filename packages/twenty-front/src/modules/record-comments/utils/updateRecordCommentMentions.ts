import { type RecordCommentMentionInput } from '~/generated/graphql';

export const updateRecordCommentMentions = ({
  previousBody,
  body,
  mentions,
}: {
  previousBody: string;
  body: string;
  mentions: RecordCommentMentionInput[];
}): RecordCommentMentionInput[] => {
  let start = 0;
  while (
    start < previousBody.length &&
    start < body.length &&
    previousBody[start] === body[start]
  ) {
    start++;
  }
  let previousEnd = previousBody.length;
  let end = body.length;
  while (
    previousEnd > start &&
    end > start &&
    previousBody[previousEnd - 1] === body[end - 1]
  ) {
    previousEnd--;
    end--;
  }
  const difference = body.length - previousBody.length;
  return mentions.flatMap((mention) => {
    if (mention.end <= start) {
      return [mention];
    }
    if (mention.start >= previousEnd) {
      return [
        {
          ...mention,
          start: mention.start + difference,
          end: mention.end + difference,
        },
      ];
    }
    return [];
  });
};

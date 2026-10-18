import { updateRecordCommentMentions } from '@/record-comments/utils/updateRecordCommentMentions';

const mention = { workspaceMemberId: 'member-id', start: 3, end: 12 };
const previousBody = 'Hi @Jony Ive, please review.';

describe('updateRecordCommentMentions', () => {
  it('keeps an unchanged mention', () => {
    expect(
      updateRecordCommentMentions({
        previousBody,
        body: previousBody,
        mentions: [mention],
      }),
    ).toEqual([mention]);
  });
  it('moves the reference when text is inserted before it', () => {
    expect(
      updateRecordCommentMentions({
        previousBody,
        body: 'Hello! ' + previousBody,
        mentions: [mention],
      }),
    ).toEqual([{ ...mention, start: 10, end: 19 }]);
  });
  it('keeps the reference when text is appended after it', () => {
    expect(
      updateRecordCommentMentions({
        previousBody,
        body: previousBody + ' Thanks.',
        mentions: [mention],
      }),
    ).toEqual([mention]);
  });
  it('removes the reference when the name is edited', () => {
    expect(
      updateRecordCommentMentions({
        previousBody,
        body: previousBody.replace('Jony', 'Johnny'),
        mentions: [mention],
      }),
    ).toEqual([]);
  });
  it('removes the reference when part of it is deleted', () => {
    expect(
      updateRecordCommentMentions({
        previousBody,
        body: previousBody.replace('@Jony ', ''),
        mentions: [mention],
      }),
    ).toEqual([]);
  });
  it('handles UTF-16 offsets when an emoji is inserted', () => {
    expect(
      updateRecordCommentMentions({
        previousBody,
        body: '👋 ' + previousBody,
        mentions: [mention],
      }),
    ).toEqual([{ ...mention, start: 6, end: 15 }]);
  });
});

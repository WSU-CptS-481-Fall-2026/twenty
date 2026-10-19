import { isNonEmptyString } from '@sniptt/guards';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { type RefObject, useId, useRef, useState } from 'react';
import { Avatar } from 'twenty-ui/data-display';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { currentWorkspaceMembersState } from '@/auth/states/currentWorkspaceMembersState';
import { type RecordCommentDraft } from '@/record-comments/states/recordCommentDraftFamilyState';
import { updateRecordCommentMentions } from '@/record-comments/utils/updateRecordCommentMentions';
import { TextArea } from '@/ui/input/components/TextArea';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { type PartialWorkspaceMember } from '@/settings/roles/types/RoleWithPartialMembers';
import { getAbsoluteImageUrl } from '~/utils/image/getAbsoluteImageUrl';

const StyledSuggestions = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  margin-top: ${themeCssVariables.spacing[3]};
  max-height: 180px;
  overflow-y: auto;
  padding-top: ${themeCssVariables.spacing[2]};
`;

const StyledOption = styled.button`
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[2]};
  text-align: left;
  width: 100%;

  &[aria-selected='true'],
  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

type RecordCommentInputProps = {
  textAreaRef?: RefObject<HTMLTextAreaElement | null>;
  recordId: string;
  body: string;
  mentions: NonNullable<NonNullable<RecordCommentDraft>['mentions']>;
  disabled: boolean;
  onChange: (
    draft: Pick<NonNullable<RecordCommentDraft>, 'body' | 'mentions'>,
  ) => void;
};

export const RecordCommentInput = ({
  textAreaRef,
  recordId,
  body,
  mentions,
  disabled,
  onChange,
}: RecordCommentInputProps) => {
  const currentWorkspaceMembers = useAtomStateValue(
    currentWorkspaceMembersState,
  );
  const localInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = textAreaRef ?? localInputRef;
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const prefix = isDefined(caret) ? body.slice(0, caret) : '';
  const match = /(?:^|\s)@([^\s@]*)$/.exec(prefix);
  const trigger =
    isDefined(match) &&
    isDefined(caret) &&
    !mentions.some((mention) => caret > mention.start && caret <= mention.end)
      ? {
          start: prefix.lastIndexOf('@'),
          end: caret,
          query: match[1].toLocaleLowerCase(),
        }
      : null;
  const candidates = isDefined(trigger)
    ? currentWorkspaceMembers
        .filter((member) =>
          `${member.name.firstName} ${member.name.lastName}`
            .toLocaleLowerCase()
            .includes(trigger.query),
        )
        .slice(0, 8)
    : [];
  const activeIndex = Math.min(
    selectedIndex,
    Math.max(0, candidates.length - 1),
  );

  const selectMember = (member: PartialWorkspaceMember) => {
    if (!isDefined(trigger)) {
      return;
    }
    const label = [member.name.firstName, member.name.lastName]
      .filter(isNonEmptyString)
      .join(' ');
    const text = `@${label}`;
    const nextBody =
      body.slice(0, trigger.start) + text + ' ' + body.slice(trigger.end);
    const nextMentions = updateRecordCommentMentions({
      previousBody: body,
      body: nextBody,
      mentions,
    });
    onChange({
      body: nextBody,
      mentions: [
        ...nextMentions,
        {
          workspaceMemberId: member.id,
          start: trigger.start,
          end: trigger.start + text.length,
        },
      ].sort((first, second) => first.start - second.start),
    });
    setCaret(null);
    requestAnimationFrame(() => {
      const position = trigger.start + text.length + 1;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  };

  return (
    <>
      <TextArea
        textAreaId={`record-comment-${recordId}`}
        textAreaRef={inputRef}
        label={t`Write a comment`}
        placeholder={t`Share an update, use @ to mention someone...`}
        value={body}
        variant="transparent"
        minRows={2}
        maxRows={10}
        disabled={disabled}
        ariaControls={isDefined(trigger) ? listId : undefined}
        ariaActiveDescendant={
          isDefined(trigger) && candidates.length > 0
            ? `${listId}-${activeIndex}`
            : undefined
        }
        onBlur={() => setCaret(null)}
        onSelect={(event) => {
          setCaret(
            event.currentTarget.selectionStart ===
              event.currentTarget.selectionEnd
              ? event.currentTarget.selectionStart
              : null,
          );
          setSelectedIndex(0);
        }}
        onChange={(value) =>
          onChange({
            body: value,
            mentions: updateRecordCommentMentions({
              previousBody: body,
              body: value,
              mentions,
            }),
          })
        }
        onKeyDown={(event) => {
          if (!isDefined(trigger) || event.nativeEvent.isComposing) {
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setCaret(null);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const nextIndex =
              (activeIndex +
                (event.key === 'ArrowDown' ? 1 : -1) +
                candidates.length) %
              Math.max(1, candidates.length);
            setSelectedIndex(nextIndex);
            document
              .getElementById(`${listId}-${nextIndex}`)
              ?.scrollIntoView({ block: 'nearest' });
          } else if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            isDefined(candidates[activeIndex])
          ) {
            event.preventDefault();
            selectMember(candidates[activeIndex]);
          }
        }}
      />
      {isDefined(trigger) && (
        <StyledSuggestions
          role="listbox"
          aria-label={t`Mention people`}
          id={listId}
        >
          {candidates.length === 0 ? (
            <span>{t`No matching workspace members`}</span>
          ) : (
            candidates.map((member, index) => (
              <StyledOption
                key={member.id}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                disabled={disabled}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMember(member)}
              >
                <Avatar
                  name={`${member.name.firstName} ${member.name.lastName}`}
                  colorSeed={member.id}
                  src={getAbsoluteImageUrl(member.avatarUrl)}
                  size="lg"
                  shape="circle"
                />
                {member.name.firstName} {member.name.lastName}
              </StyledOption>
            ))
          )}
        </StyledSuggestions>
      )}
    </>
  );
};

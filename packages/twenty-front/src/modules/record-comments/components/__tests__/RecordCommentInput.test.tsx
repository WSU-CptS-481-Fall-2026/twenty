import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { RecordCommentInput } from '@/record-comments/components/RecordCommentInput';
import { type RecordCommentMentionInput } from '~/generated/graphql';

jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => [
    { id: 'jony-id', name: { firstName: 'Jony', lastName: 'Ive' } },
    { id: 'tim-id', name: { firstName: 'Tim', lastName: 'Apple' } },
  ],
}));

const Input = ({ disabled = false }: { disabled?: boolean }) => {
  const [draft, setDraft] = useState<{
    body: string;
    mentions?: RecordCommentMentionInput[];
  }>({ body: '', mentions: [] });
  return (
    <>
      <RecordCommentInput
        recordId="record-id"
        body={draft.body}
        mentions={draft.mentions ?? []}
        disabled={disabled}
        onChange={setDraft}
      />
      <output aria-label="Saved references">
        {JSON.stringify(draft.mentions)}
      </output>
    </>
  );
};

describe('RecordCommentInput', () => {
  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  it('moves the selected member with arrow keys', async () => {
    const user = userEvent.setup();
    render(<Input />);
    await user.type(screen.getByRole('textbox'), '@');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByRole('textbox')).toHaveValue('@Tim Apple ');
  });
  it('selects a workspace member with the keyboard and stores a stable reference', async () => {
    const user = userEvent.setup();
    render(<Input />);
    await user.type(screen.getByRole('textbox'), 'Hi @jo');
    expect(screen.getByRole('option', { name: 'Jony Ive' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.queryByRole('option', { name: 'Tim Apple' }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox')).toHaveValue('Hi @Jony Ive ');
    expect(screen.getByLabelText('Saved references')).toHaveTextContent(
      '"workspaceMemberId":"jony-id","start":3,"end":12',
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  it('supports selecting a person with the pointer', async () => {
    const user = userEvent.setup();
    render(<Input />);
    await user.type(screen.getByRole('textbox'), '@');
    await user.click(screen.getByRole('option', { name: 'Tim Apple' }));
    expect(screen.getByRole('textbox')).toHaveValue('@Tim Apple ');
    expect(screen.getByLabelText('Saved references')).toHaveTextContent(
      'tim-id',
    );
  });
  it('does not select a mention while the input is disabled', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Input />);
    await user.type(screen.getByRole('textbox'), '@');
    rerender(<Input disabled />);
    await user.click(screen.getByRole('option', { name: 'Tim Apple' }));
    expect(screen.getByRole('textbox')).toHaveValue('@');
    expect(screen.getByLabelText('Saved references')).toHaveTextContent('[]');
  });

  it('dismisses suggestions with Escape without changing text', async () => {
    const user = userEvent.setup();
    render(<Input />);
    await user.type(screen.getByRole('textbox'), '@jo');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('@jo');
  });
  it('does not treat an email address as a mention', async () => {
    const user = userEvent.setup();
    render(<Input />);
    await user.type(screen.getByRole('textbox'), 'person@example.com');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

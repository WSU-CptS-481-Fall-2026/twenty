import { StyledWidgetScrollContainer } from '@/ui/layout/components/WidgetContentContainer';
import { WidgetContentShell } from '@/page-layout/widgets/components/WidgetContentShell';
import { RecordComments } from '@/record-comments/components/RecordComments';
import { useTargetRecord } from '@/ui/layout/contexts/useTargetRecord';

export const CommentsWidget = () => {
  const targetRecordIdentifier = useTargetRecord();

  return (
    <WidgetContentShell>
      <StyledWidgetScrollContainer>
        <RecordComments targetRecordIdentifier={targetRecordIdentifier} />
      </StyledWidgetScrollContainer>
    </WidgetContentShell>
  );
};

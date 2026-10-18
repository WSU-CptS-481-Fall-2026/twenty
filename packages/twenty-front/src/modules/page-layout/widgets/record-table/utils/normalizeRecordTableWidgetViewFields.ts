import { isDefined } from 'twenty-shared/utils';

type RecordTableWidgetViewFieldWithLabelIdentifierInvariant = {
  fieldMetadataId: string;
  isVisible: boolean;
  position: number;
};

type NormalizeRecordTableWidgetViewFieldsArgs<
  ViewField extends RecordTableWidgetViewFieldWithLabelIdentifierInvariant,
> = {
  viewFields: ViewField[];
  labelIdentifierFieldMetadataId: string;
  isLabelIdentifierSystemIdField?: boolean;
};

export const normalizeRecordTableWidgetViewFields = <
  ViewField extends RecordTableWidgetViewFieldWithLabelIdentifierInvariant,
>({
  viewFields,
  labelIdentifierFieldMetadataId,
  isLabelIdentifierSystemIdField = false,
}: NormalizeRecordTableWidgetViewFieldsArgs<ViewField>): ViewField[] => {
  const labelIdentifierViewField = viewFields.find(
    (viewField) => viewField.fieldMetadataId === labelIdentifierFieldMetadataId,
  );

  if (!isDefined(labelIdentifierViewField) || isLabelIdentifierSystemIdField) {
    return viewFields;
  }

  const normalizedLabelIdentifierViewField: ViewField = {
    ...labelIdentifierViewField,
    isVisible: true,
    position: 0,
  };

  const normalizedOtherViewFields = viewFields
    .filter(
      (viewField) =>
        viewField.fieldMetadataId !== labelIdentifierFieldMetadataId,
    )
    .toSorted((viewFieldA, viewFieldB) => {
      return viewFieldA.position - viewFieldB.position;
    })
    .map<ViewField>((viewField, index) => ({
      ...viewField,
      position: index + 1,
    }));

  return [normalizedLabelIdentifierViewField, ...normalizedOtherViewFields];
};

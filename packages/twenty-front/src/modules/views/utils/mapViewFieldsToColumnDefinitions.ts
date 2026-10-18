import { type FieldMetadata } from '@/object-record/record-field/ui/types/FieldMetadata';
import { type ColumnDefinition } from '@/object-record/record-table/types/ColumnDefinition';
import { mapArrayToObject } from '~/utils/array/mapArrayToObject';
import { moveArrayItem } from '~/utils/array/moveArrayItem';
import { isUndefinedOrNull } from '~/utils/isUndefinedOrNull';

import { type ViewField } from '@/views/types/ViewField';
import { isDefined } from 'twenty-shared/utils';

export const mapViewFieldsToColumnDefinitions = ({
  columnDefinitions,
  viewFields,
  isLabelIdentifierSystemIdField = false,
}: {
  columnDefinitions: ColumnDefinition<FieldMetadata>[];
  viewFields: ViewField[];
  isLabelIdentifierSystemIdField?: boolean;
}): ColumnDefinition<FieldMetadata>[] => {
  let labelIdentifierFieldMetadataId = '';

  const columnDefinitionsByFieldMetadataId = mapArrayToObject(
    columnDefinitions,
    ({ fieldMetadataId }) => fieldMetadataId,
  );

  const columnDefinitionsFromViewFields = viewFields
    .map((viewField) => {
      const correspondingColumnDefinition =
        columnDefinitionsByFieldMetadataId[viewField.fieldMetadataId];

      if (isUndefinedOrNull(correspondingColumnDefinition)) return null;

      const { isLabelIdentifier } = correspondingColumnDefinition;

      const shouldPinLabelIdentifier =
        isLabelIdentifier === true && !isLabelIdentifierSystemIdField;

      if (isLabelIdentifier === true) {
        labelIdentifierFieldMetadataId =
          correspondingColumnDefinition.fieldMetadataId;
      }

      return {
        fieldMetadataId: viewField.fieldMetadataId,
        label: correspondingColumnDefinition.label,
        metadata: correspondingColumnDefinition.metadata,
        iconName: correspondingColumnDefinition.iconName,
        type: correspondingColumnDefinition.type,
        position: shouldPinLabelIdentifier ? 0 : viewField.position,
        size: viewField.size ?? correspondingColumnDefinition.size,
        isLabelIdentifier,
        isVisible: shouldPinLabelIdentifier || viewField.isVisible,
        viewFieldId: viewField.id,
        isUIEditable: correspondingColumnDefinition.metadata.isUIEditable,
        isSortable: correspondingColumnDefinition.isSortable,
        isFilterable: correspondingColumnDefinition.isFilterable,
        defaultValue: correspondingColumnDefinition.defaultValue,
        settings:
          'settings' in correspondingColumnDefinition.metadata
            ? correspondingColumnDefinition.metadata.settings
            : undefined,
      } as ColumnDefinition<FieldMetadata>;
    })
    .filter(isDefined);

  if (!labelIdentifierFieldMetadataId) return columnDefinitionsFromViewFields;

  const labelIdentifierIndex = columnDefinitionsFromViewFields.findIndex(
    ({ fieldMetadataId }) => fieldMetadataId === labelIdentifierFieldMetadataId,
  );

  if (isLabelIdentifierSystemIdField) return columnDefinitionsFromViewFields;

  return moveArrayItem(columnDefinitionsFromViewFields, {
    fromIndex: labelIdentifierIndex,
    toIndex: 0,
  });
};

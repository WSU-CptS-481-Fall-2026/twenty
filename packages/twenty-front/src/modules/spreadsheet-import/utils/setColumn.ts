import { type MatchColumnsStepProps } from '@/spreadsheet-import/steps/components/MatchColumnsStep/MatchColumnsStep';

import {
  type SpreadsheetImportField,
  type SpreadsheetImportMultiSelect,
  type SpreadsheetImportSelect,
} from '@/spreadsheet-import/types';
import { type SpreadsheetColumn } from '@/spreadsheet-import/types/SpreadsheetColumn';
import { SpreadsheetColumnType } from '@/spreadsheet-import/types/SpreadsheetColumnType';
import { spreadsheetImportParseMultiSelectOptionsOrThrow } from '@/spreadsheet-import/utils/spreadsheetImportParseMultiSelectOptionsOrThrow';
import { t } from '@lingui/core/macro';
import { isDefined } from 'twenty-shared/utils';
import { type SelectOption } from 'twenty-ui/input';
import { uniqueEntries } from './uniqueEntries';

const findMatchingOptionValue = (
  entry: string,
  fieldOptions: SelectOption[],
): string | undefined =>
  fieldOptions.find(
    (option) => option.value === entry || option.label === entry,
  )?.value;

const buildMatchedSelectColumn = (
  oldColumn: SpreadsheetColumn,
  field: SpreadsheetImportField,
  entries: string[],
): SpreadsheetColumn => {
  const fieldOptions = (
    field.fieldType as SpreadsheetImportSelect | SpreadsheetImportMultiSelect
  ).options;
  const matchedOptions = entries.map((entry) => {
    const value = findMatchingOptionValue(entry, fieldOptions);
    return value ? { entry, value } : { entry };
  });
  const allMatched =
    matchedOptions.filter((option) => option.value).length === entries.length;

  return {
    ...oldColumn,
    type: allMatched
      ? SpreadsheetColumnType.matchedSelectOptions
      : SpreadsheetColumnType.matchedSelect,
    value: field.key,
    matchedOptions,
  };
};

export const setColumn = (
  oldColumn: SpreadsheetColumn,
  field?: SpreadsheetImportField,
  data?: MatchColumnsStepProps['data'],
): SpreadsheetColumn => {
  if (field?.fieldType.type === 'select') {
    const entries = uniqueEntries(data || [], oldColumn.index).map(
      ({ entry }) => entry as string,
    );

    return buildMatchedSelectColumn(oldColumn, field, entries);
  }

  if (field?.fieldType.type === 'multiSelect') {
    let entries: string[] = [];
    try {
      entries = [
        ...new Set(
          data
            ?.flatMap((row) => {
              const value = row[oldColumn.index];
              if (!isDefined(value)) return [];
              return spreadsheetImportParseMultiSelectOptionsOrThrow(value);
            })
            .filter((entry) => typeof entry === 'string'),
        ),
      ];
    } catch {
      return {
        index: oldColumn.index,
        header: oldColumn.header,
        type: SpreadsheetColumnType.matchedError,
        value: field.key,
        errorMessage: t`column data is not compatible with Multi-Select. Format required is '["option1", "option2"]' or option1,option2.`,
      };
    }

    return buildMatchedSelectColumn(oldColumn, field, entries);
  }

  if (field?.fieldType.type === 'checkbox') {
    return {
      index: oldColumn.index,
      type: SpreadsheetColumnType.matchedCheckbox,
      value: field.key,
      header: oldColumn.header,
    };
  }

  if (field?.fieldType.type === 'input') {
    return {
      index: oldColumn.index,
      type: SpreadsheetColumnType.matched,
      value: field.key,
      header: oldColumn.header,
    };
  }

  return {
    index: oldColumn.index,
    header: oldColumn.header,
    type: SpreadsheetColumnType.empty,
  };
};

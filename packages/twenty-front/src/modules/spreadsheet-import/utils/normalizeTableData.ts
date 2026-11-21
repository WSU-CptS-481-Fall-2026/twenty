import {
  type ImportedRow,
  type ImportedStructuredRow,
  type SpreadsheetImportFields,
} from '@/spreadsheet-import/types';
import {
  type SpreadsheetColumn,
  type SpreadsheetMatchedSelectColumn,
  type SpreadsheetMatchedSelectOptionsColumn,
} from '@/spreadsheet-import/types/SpreadsheetColumn';
import { type SpreadsheetColumns } from '@/spreadsheet-import/types/SpreadsheetColumns';
import { SpreadsheetColumnType } from '@/spreadsheet-import/types/SpreadsheetColumnType';
import { spreadsheetImportParseMultiSelectOptionsOrThrow } from '@/spreadsheet-import/utils/spreadsheetImportParseMultiSelectOptionsOrThrow';
import { isDefined } from 'twenty-shared/utils';
import { z } from 'zod';
import { normalizeCheckboxValue } from './normalizeCheckboxValue';

type SpreadsheetCheckboxColumn = Extract<
  SpreadsheetColumn,
  { type: SpreadsheetColumnType.matchedCheckbox }
>;

type SpreadsheetSelectColumn =
  | SpreadsheetMatchedSelectColumn
  | SpreadsheetMatchedSelectOptionsColumn;

const normalizeCheckboxCell = (
  column: SpreadsheetCheckboxColumn,
  cellValue: string | undefined,
  fields: SpreadsheetImportFields,
): ImportedStructuredRow => {
  const field = fields.find((field) => field.key === column.value);

  if (!field) {
    return {};
  }

  if (!('booleanMatches' in field.fieldType)) {
    return { [column.value]: normalizeCheckboxValue(cellValue) };
  }

  const booleanMatchKey = Object.keys(
    field.fieldType.booleanMatches || [],
  ).find((key) => key.toLowerCase() === cellValue?.toLowerCase());

  if (!booleanMatchKey) {
    return {};
  }

  const booleanMatch = field.fieldType.booleanMatches?.[booleanMatchKey];

  return { [column.value]: booleanMatch };
};

const normalizeMultiSelectCellValue = (
  matchedOptions: SpreadsheetSelectColumn['matchedOptions'],
  cellValue: string,
): string | undefined => {
  const currentOptionsSchema = z.preprocess(
    spreadsheetImportParseMultiSelectOptionsOrThrow,
    z.array(z.unknown()),
  );

  const rawCurrentOptions = currentOptionsSchema.safeParse(cellValue).data;

  const matchedOptionValues = [
    ...new Set(
      rawCurrentOptions
        ?.map(
          (option) =>
            matchedOptions.find(
              (matchedOption) => matchedOption.entry === option,
            )?.value,
        )
        .filter(isDefined),
    ),
  ];

  return matchedOptionValues.length > 0
    ? JSON.stringify(matchedOptionValues)
    : undefined;
};

const normalizeSelectCell = (
  column: SpreadsheetSelectColumn,
  cellValue: string | undefined,
  fields: SpreadsheetImportFields,
): ImportedStructuredRow => {
  const field = fields.find((field) => field.key === column.value);

  if (!field) {
    return {};
  }

  if (field.fieldType.type === 'multiSelect' && isDefined(cellValue)) {
    const fieldValue = normalizeMultiSelectCellValue(
      column.matchedOptions,
      cellValue,
    );

    return { [column.value]: fieldValue };
  }

  const matchedOption = column.matchedOptions.find(
    ({ entry }) => entry === cellValue,
  );

  return { [column.value]: matchedOption?.value || undefined };
};

export const normalizeTableData = (
  columns: SpreadsheetColumns,
  data: ImportedRow[],
  fields: SpreadsheetImportFields,
) =>
  data.map((row) =>
    columns.reduce((acc, column, index) => {
      const curr = row[index];
      switch (column.type) {
        case SpreadsheetColumnType.matchedCheckbox:
          return Object.assign(
            acc,
            normalizeCheckboxCell(column, curr, fields),
          );
        case SpreadsheetColumnType.matched: {
          acc[column.value] = curr === '' ? undefined : curr;
          return acc;
        }
        case SpreadsheetColumnType.matchedSelect:
        case SpreadsheetColumnType.matchedSelectOptions:
          return Object.assign(acc, normalizeSelectCell(column, curr, fields));
        case SpreadsheetColumnType.empty:
        case SpreadsheetColumnType.ignored: {
          return acc;
        }
        default:
          return acc;
      }
    }, {} as ImportedStructuredRow),
  );

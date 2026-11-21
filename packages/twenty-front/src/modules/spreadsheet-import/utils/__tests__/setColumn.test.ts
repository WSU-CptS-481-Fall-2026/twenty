import {
  type ImportedRow,
  type SpreadsheetImportField,
} from '@/spreadsheet-import/types';
import { type SpreadsheetColumn } from '@/spreadsheet-import/types/SpreadsheetColumn';
import { SpreadsheetColumnType } from '@/spreadsheet-import/types/SpreadsheetColumnType';
import { setColumn } from '@/spreadsheet-import/utils/setColumn';
import { FieldMetadataType } from 'twenty-shared/types';

describe('setColumn', () => {
  const defaultField = {
    Icon: null,
    label: 'label',
    key: 'Name',
    fieldType: { type: 'input' },
    fieldMetadataType: FieldMetadataType.TEXT,
  } as SpreadsheetImportField;

  const oldColumn: SpreadsheetColumn = {
    index: 0,
    header: 'Name',
    type: SpreadsheetColumnType.matched,
    value: 'oldValue',
  };

  it('should return a matchedSelectOptions column if field type is "select"', () => {
    const field = {
      ...defaultField,
      fieldType: {
        type: 'select',
        options: [{ value: 'John' }, { value: 'Alice' }],
      },
    } as SpreadsheetImportField;

    const data = [['John'], ['Alice']];
    const result = setColumn(oldColumn, field, data);

    expect(result).toEqual({
      index: 0,
      header: 'Name',
      type: SpreadsheetColumnType.matchedSelectOptions,
      value: 'Name',
      matchedOptions: [
        {
          entry: 'John',
          value: 'John',
        },
        {
          entry: 'Alice',
          value: 'Alice',
        },
      ],
    });
  });

  it('should return a matchedCheckbox column if field type is "checkbox"', () => {
    const field = {
      ...defaultField,
      fieldType: { type: 'checkbox' },
    } as SpreadsheetImportField;

    const result = setColumn(oldColumn, field);

    expect(result).toEqual({
      index: 0,
      header: 'Name',
      type: SpreadsheetColumnType.matchedCheckbox,
      value: 'Name',
    });
  });

  it('should return a matched column if field type is "input"', () => {
    const field = {
      ...defaultField,
      fieldType: { type: 'input' },
    } as SpreadsheetImportField;

    const result = setColumn(oldColumn, field);

    expect(result).toEqual({
      index: 0,
      header: 'Name',
      type: SpreadsheetColumnType.matched,
      value: 'Name',
    });
  });

  it('should return an empty column if field type is not recognized', () => {
    const field = {
      ...defaultField,
      fieldType: { type: 'unknown' },
    } as unknown as SpreadsheetImportField;

    const result = setColumn(oldColumn, field);

    expect(result).toEqual({
      index: 0,
      header: 'Name',
      type: SpreadsheetColumnType.empty,
    });
  });

  const multiSelectField: SpreadsheetImportField = {
    ...defaultField,
    fieldMetadataType: FieldMetadataType.MULTI_SELECT,
    fieldType: {
      type: 'multiSelect',
      options: [
        { label: 'Beta', value: 'b' },
        { label: 'Alpha', value: 'a' },
        { label: 'Other', value: 'Beta' },
        { label: 'Blank', value: '' },
        { label: 'Blank', value: 'later' },
      ],
    },
  };

  const selectField: SpreadsheetImportField = {
    ...defaultField,
    fieldMetadataType: FieldMetadataType.SELECT,
    fieldType: { type: 'select', options: [{ label: 'Alpha', value: 'a' }] },
  };

  it('should match multiselect JSON entries by label or value in first-seen order', () => {
    const data = [
      ['["Beta", 7, true, null, {"value": "a"}, ["a"], "a"]'],
      [undefined],
      ['["a", "Beta", "b"]'],
    ];

    expect(setColumn(oldColumn, multiSelectField, data)).toStrictEqual({
      index: 0,
      header: 'Name',
      type: SpreadsheetColumnType.matchedSelectOptions,
      value: 'Name',
      matchedOptions: [
        { entry: 'Beta', value: 'b' },
        { entry: 'a', value: 'a' },
        { entry: 'b', value: 'b' },
      ],
    });
  });

  it('should leave unmatched and empty-valued comma-separated entries without a value', () => {
    const data = [['a, Missing, Blank']];

    expect(setColumn(oldColumn, multiSelectField, data)).toStrictEqual({
      index: 0,
      header: 'Name',
      type: SpreadsheetColumnType.matchedSelect,
      value: 'Name',
      matchedOptions: [
        { entry: 'a', value: 'a' },
        { entry: 'Missing' },
        { entry: 'Blank' },
      ],
    });
  });

  it('should return the multiselect error column when a cell cannot be parsed', () => {
    const malformedRow: ImportedRow = [];
    Reflect.set(malformedRow, 0, 42);

    expect(
      setColumn(oldColumn, multiSelectField, [malformedRow]),
    ).toStrictEqual({
      index: 0,
      header: 'Name',
      type: SpreadsheetColumnType.matchedError,
      value: 'Name',
      errorMessage:
        'column data is not compatible with Multi-Select. Format required is \'["option1", "option2"]\' or option1,option2.',
    });
  });

  it.each(['select', 'multiSelect'] as const)(
    'should return a matchedSelectOptions column with no options for %s when data is undefined',
    (type) => {
      const field: SpreadsheetImportField = {
        ...defaultField,
        fieldType: { type, options: [{ label: 'Alpha', value: 'a' }] },
      };

      expect(setColumn(oldColumn, field)).toStrictEqual({
        index: 0,
        header: 'Name',
        type: SpreadsheetColumnType.matchedSelectOptions,
        value: 'Name',
        matchedOptions: [],
      });
    },
  );

  it('should return an empty column when no field is provided', () => {
    expect(setColumn(oldColumn)).toStrictEqual({
      index: 0,
      header: 'Name',
      type: SpreadsheetColumnType.empty,
    });
  });

  it('should include values only for matched select entries', () => {
    const data = [['a'], ['Missing']];

    expect(setColumn(oldColumn, selectField, data)).toStrictEqual({
      index: 0,
      header: 'Name',
      type: SpreadsheetColumnType.matchedSelect,
      value: 'Name',
      matchedOptions: [{ entry: 'a', value: 'a' }, { entry: 'Missing' }],
    });
  });

  it('should match a select entry by option label and return its value', () => {
    const data = [['Alpha']];

    expect(setColumn(oldColumn, selectField, data)).toStrictEqual({
      index: 0,
      header: 'Name',
      type: SpreadsheetColumnType.matchedSelectOptions,
      value: 'Name',
      matchedOptions: [{ entry: 'Alpha', value: 'a' }],
    });
  });
});

import { type SpreadsheetImportField } from '@/spreadsheet-import/types';
import { type SpreadsheetColumn } from '@/spreadsheet-import/types/SpreadsheetColumn';
import { type SpreadsheetColumns } from '@/spreadsheet-import/types/SpreadsheetColumns';
import { SpreadsheetColumnType } from '@/spreadsheet-import/types/SpreadsheetColumnType';
import { normalizeTableData } from '@/spreadsheet-import/utils/normalizeTableData';
import { FieldMetadataType } from 'twenty-shared/types';

describe('normalizeTableData', () => {
  const columns: SpreadsheetColumn[] = [
    {
      index: 0,
      header: 'Name',
      type: SpreadsheetColumnType.matched,
      value: 'name',
    },
    {
      index: 1,
      header: 'Age',
      type: SpreadsheetColumnType.matched,
      value: 'age',
    },
    {
      index: 2,
      header: 'Active',
      type: SpreadsheetColumnType.matchedCheckbox,
      value: 'active',
    },
  ];

  const fields = [
    {
      key: 'name',
      label: 'Name',
      fieldType: { type: 'input' },
      fieldMetadataType: FieldMetadataType.TEXT,
      Icon: null,
    },
    {
      key: 'age',
      label: 'Age',
      fieldType: { type: 'input' },
      fieldMetadataType: FieldMetadataType.NUMBER,
      Icon: null,
    },
    {
      key: 'active',
      label: 'Active',
      fieldType: {
        type: 'checkbox',
      },
      fieldMetadataType: FieldMetadataType.BOOLEAN,
      Icon: null,
    },
  ] as SpreadsheetImportField[];

  const rawData = [
    ['John', '30', 'Yes'],
    ['Alice', '', 'No'],
    ['Bob', '25', 'Maybe'],
  ];

  it('should normalize table data according to columns and fields', () => {
    const result = normalizeTableData(columns, rawData, fields);

    expect(result).toStrictEqual([
      { name: 'John', age: '30', active: true },
      { name: 'Alice', age: undefined, active: false },
      { name: 'Bob', age: '25', active: false },
    ]);
  });

  it('should normalize matchedCheckbox values and handle booleanMatches', () => {
    const columns: SpreadsheetColumn[] = [
      {
        index: 0,
        header: 'Active',
        type: SpreadsheetColumnType.matchedCheckbox,
        value: 'active',
      },
    ];

    const fields = [
      {
        key: 'active',
        label: 'Active',
        fieldType: {
          type: 'checkbox',
          booleanMatches: { yes: true, no: false },
        },
        fieldMetadataType: FieldMetadataType.BOOLEAN,
        Icon: null,
        fieldMetadataItemId: '1',
        isNestedField: false,
      },
    ] as SpreadsheetImportField[];

    const rawData = [['Yes'], ['No'], ['OtherValue']];

    const result = normalizeTableData(columns, rawData, fields);

    expect(result).toStrictEqual([{ active: true }, { active: false }, {}]);
  });

  it('should map matchedSelect and matchedSelectOptions values correctly', () => {
    const columns: SpreadsheetColumn[] = [
      {
        index: 0,
        header: 'Number',
        type: SpreadsheetColumnType.matchedSelect,
        value: 'number',
        matchedOptions: [
          { entry: 'One', value: '1' },
          { entry: 'Two', value: '2' },
        ],
      },
    ];

    const fields = [
      {
        key: 'number',
        label: 'Number',
        fieldType: {
          type: 'select',
          options: [
            { label: 'One', value: '1' },
            { label: 'Two', value: '2' },
          ],
        },
        fieldMetadataType: FieldMetadataType.SELECT,
        Icon: null,
      },
    ] as SpreadsheetImportField[];

    const rawData = [['One'], ['Two'], ['OtherValue']];

    const result = normalizeTableData(columns, rawData, fields);

    expect(result).toStrictEqual([
      { number: '1' },
      { number: '2' },
      { number: undefined },
    ]);
  });

  it('should handle empty and ignored columns', () => {
    const columns: SpreadsheetColumn[] = [
      { index: 0, header: 'Empty', type: SpreadsheetColumnType.empty },
      { index: 1, header: 'Ignored', type: SpreadsheetColumnType.ignored },
    ];

    const rawData = [['Value1', 'Value2']];

    const result = normalizeTableData(columns, rawData, []);

    expect(result).toStrictEqual([{}]);
  });

  it('should handle unrecognized column types and return empty object', () => {
    const columns: SpreadsheetColumns = [
      {
        index: 0,
        header: 'Unrecognized',
        type: 'Unknown' as unknown as SpreadsheetColumnType.matched,
        value: '',
      },
    ];

    const rawData = [['Value']];

    const result = normalizeTableData(columns, rawData, []);

    expect(result).toStrictEqual([{}]);
  });

  it('should normalize mixed-case true without booleanMatches', () => {
    const result = normalizeTableData(
      columns,
      [['Chris', '40', 'TrUe']],
      fields,
    );

    expect(result).toStrictEqual([{ name: 'Chris', age: '40', active: true }]);
  });

  it('should keep the key for an empty matched cell', () => {
    const [result] = normalizeTableData(columns, [['Alice', '', 'No']], fields);

    expect(result).toHaveProperty('age', undefined);
  });

  describe('checkbox cells with booleanMatches', () => {
    const columns: SpreadsheetColumns = [
      {
        index: 0,
        header: 'Active',
        type: SpreadsheetColumnType.matchedCheckbox,
        value: 'active',
      },
    ];

    const fields: SpreadsheetImportField[] = [
      {
        key: 'active',
        label: 'Active',
        fieldType: {
          type: 'checkbox',
          booleanMatches: { yes: true, YES: false, no: false },
        },
        fieldMetadataType: FieldMetadataType.BOOLEAN,
        Icon: null,
        fieldMetadataItemId: '1',
        isNestedField: false,
      },
    ];

    it('should use the first case-insensitive boolean match', () => {
      const result = normalizeTableData(columns, [['yEs'], ['NO']], fields);

      expect(result).toStrictEqual([{ active: true }, { active: false }]);
    });

    it('should omit the checkbox key when no boolean match exists', () => {
      const [result] = normalizeTableData(columns, [['true']], fields);

      expect(result).not.toHaveProperty('active');
    });
  });

  it('should omit the checkbox when booleanMatches is present but undefined', () => {
    const checkboxField: SpreadsheetImportField = {
      key: 'active',
      label: 'Active',
      fieldType: { type: 'checkbox', booleanMatches: undefined },
      fieldMetadataType: FieldMetadataType.BOOLEAN,
      Icon: null,
      fieldMetadataItemId: '1',
      isNestedField: false,
    };

    const [result] = normalizeTableData(
      columns,
      [['John', '30', 'yes']],
      [checkboxField],
    );

    expect(result).not.toHaveProperty('active');
  });

  it('should omit checkbox and select keys when their fields are missing', () => {
    const columns: SpreadsheetColumns = [
      {
        index: 0,
        header: 'Active',
        type: SpreadsheetColumnType.matchedCheckbox,
        value: 'active',
      },
      {
        index: 1,
        header: 'Number',
        type: SpreadsheetColumnType.matchedSelect,
        value: 'number',
        matchedOptions: [{ entry: 'One', value: '1' }],
      },
    ];

    const [result] = normalizeTableData(columns, [['yes', 'One']], []);

    expect(result).not.toHaveProperty('active');
    expect(result).not.toHaveProperty('number');
  });

  it('should keep the select key when no option matches', () => {
    const columns: SpreadsheetColumns = [
      {
        index: 0,
        header: 'Number',
        type: SpreadsheetColumnType.matchedSelect,
        value: 'number',
        matchedOptions: [{ entry: 'One', value: '1' }],
      },
    ];

    const fields: SpreadsheetImportField[] = [
      {
        key: 'number',
        label: 'Number',
        fieldType: { type: 'select', options: [{ label: 'One', value: '1' }] },
        fieldMetadataType: FieldMetadataType.SELECT,
        Icon: null,
        fieldMetadataItemId: '1',
        isNestedField: false,
      },
    ];

    const [result] = normalizeTableData(columns, [['OtherValue']], fields);

    expect(result).toHaveProperty('number', undefined);
  });

  describe('multiselect cells', () => {
    const fields: SpreadsheetImportField[] = [
      {
        key: 'tags',
        label: 'Tags',
        fieldType: {
          type: 'multiSelect',
          options: [
            { label: 'First', value: 'first' },
            { label: 'Second', value: 'second' },
          ],
        },
        fieldMetadataType: FieldMetadataType.MULTI_SELECT,
        Icon: null,
        fieldMetadataItemId: '1',
        isNestedField: false,
      },
    ];

    it('should deduplicate matched values in first-occurrence order', () => {
      const columns: SpreadsheetColumns = [
        {
          index: 0,
          header: 'Tags',
          type: SpreadsheetColumnType.matchedSelectOptions,
          value: 'tags',
          matchedOptions: [
            { entry: 'First', value: 'first' },
            { entry: 'Second', value: 'second' },
            { entry: 'Another Second', value: 'second' },
          ],
        },
      ];

      const result = normalizeTableData(
        columns,
        [['["Second","First","Second","Another Second"]']],
        fields,
      );

      expect(result).toStrictEqual([{ tags: '["second","first"]' }]);
    });

    it('should keep the key when no multiselect entry matches', () => {
      const columns: SpreadsheetColumns = [
        {
          index: 0,
          header: 'Tags',
          type: SpreadsheetColumnType.matchedSelect,
          value: 'tags',
          matchedOptions: [{ entry: 'First', value: 'first' }],
        },
      ];

      const [result] = normalizeTableData(
        columns,
        [['Unknown, Other']],
        fields,
      );

      expect(result).toHaveProperty('tags', undefined);
    });

    it('should look up an undefined cell as a single entry', () => {
      const columns: SpreadsheetColumns = [
        {
          index: 0,
          header: 'Tags',
          type: SpreadsheetColumnType.matchedSelect,
          value: 'tags',
          matchedOptions: [{ value: 'first' }, { value: 'second' }],
        },
      ];

      const result = normalizeTableData(columns, [[undefined]], fields);

      expect(result).toStrictEqual([{ tags: 'first' }]);
    });
  });

  it('should leave no keys for empty and ignored columns', () => {
    const columns: SpreadsheetColumns = [
      { index: 0, header: 'Empty', type: SpreadsheetColumnType.empty },
      { index: 1, header: 'Ignored', type: SpreadsheetColumnType.ignored },
    ];

    const [result] = normalizeTableData(columns, [['Value1', 'Value2']], []);

    expect(Object.keys(result)).toStrictEqual([]);
  });
});

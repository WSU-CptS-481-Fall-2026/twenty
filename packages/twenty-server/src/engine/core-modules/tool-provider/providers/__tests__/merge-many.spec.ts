import { type ObjectPermissions } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { type I18nService } from 'src/engine/core-modules/i18n/i18n.service';
import { DatabaseToolProvider } from 'src/engine/core-modules/tool-provider/providers/database-tool.provider';
import { type ToolDescriptor } from 'src/engine/core-modules/tool-provider/types/tool-descriptor.type';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { type ApplicationTranslationCatalogService } from 'src/engine/metadata-modules/application-translation-catalog/services/application-translation-catalog.service';
import { createEmptyFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/constant/create-empty-flat-entity-maps.constant';
import { type WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { getFlatObjectMetadataMock } from 'src/engine/metadata-modules/flat-object-metadata/__mocks__/get-flat-object-metadata.mock';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const roleId = 'role-id';
const workspaceId = 'workspace-id';

const allObjectPermissions: ObjectPermissions = {
  canReadObjectRecords: true,
  canUpdateObjectRecords: true,
  canSoftDeleteObjectRecords: true,
  canDestroyObjectRecords: true,
  restrictedFields: {},
  rowLevelPermissionPredicates: [],
  rowLevelPermissionPredicateGroups: [],
};

const createFlatObject = (
  overrides: Partial<FlatObjectMetadata> &
    Pick<FlatObjectMetadata, 'nameSingular' | 'namePlural'>,
) =>
  getFlatObjectMetadataMock({
    universalIdentifier: overrides.nameSingular,
    labelSingular: overrides.nameSingular,
    labelPlural: overrides.namePlural,
    ...overrides,
  });

describe('merge_many tool descriptors', () => {
  const generateDescriptors = async (objects: FlatObjectMetadata[]) => {
    const flatObjectMetadataMaps =
      createEmptyFlatEntityMaps() as FlatEntityMaps<FlatObjectMetadata>;

    for (const object of objects) {
      flatObjectMetadataMaps.byUniversalIdentifier[object.universalIdentifier] =
        object;
      flatObjectMetadataMaps.universalIdentifierById[object.id] =
        object.universalIdentifier;
    }

    const workspaceCacheService = {
      getOrRecompute: jest.fn().mockResolvedValue({
        rolesPermissions: {
          [roleId]: Object.fromEntries(
            objects.map((object) => [object.id, allObjectPermissions]),
          ),
        },
        flatObjectPermissionMaps: {
          byUniversalIdentifier: Object.fromEntries(
            objects.map((object, index) => [
              `object-permission-${index}`,
              {
                roleId,
                objectMetadataId: object.id,
                canReadObjectRecords: true,
                canUpdateObjectRecords: true,
                canSoftDeleteObjectRecords: true,
              },
            ]),
          ),
        },
      }),
    } as unknown as WorkspaceCacheService;

    const flatEntityMapsCacheService = {
      getOrRecomputeManyOrAllFlatEntityMaps: jest.fn().mockResolvedValue({
        flatObjectMetadataMaps,
        flatFieldMetadataMaps: createEmptyFlatEntityMaps(),
      }),
    } as unknown as WorkspaceManyOrAllFlatEntityMapsCacheService;

    const i18nService = {
      translateMessage: jest.fn(
        ({ messageId }: { messageId: string }) => messageId,
      ),
      getI18nInstance: jest.fn(() => ({
        _: (descriptor: string | { id: string; message?: string }) =>
          typeof descriptor === 'string'
            ? descriptor
            : (descriptor.message ?? descriptor.id),
      })),
    } as unknown as I18nService;

    const applicationTranslationCatalogService = {
      getApplicationAuthorIdentifiers: jest.fn().mockResolvedValue({
        standardApplicationId: 'standard-application-id',
        workspaceCustomApplicationUniversalIdentifier:
          'workspace-custom-application-universal-identifier',
        universalIdentifierByApplicationId: {},
      }),
    } as unknown as ApplicationTranslationCatalogService;

    const provider = new DatabaseToolProvider(
      workspaceCacheService,
      flatEntityMapsCacheService,
      i18nService,
      applicationTranslationCatalogService,
    );

    return (await provider.generateDescriptors(
      {
        workspaceId,
        roleId,
        rolePermissionConfig: { unionOf: [roleId] },
      },
      { includeSchemas: true },
    )) as (ToolIndexEntry | ToolDescriptor)[];
  };

  it('advertises merge_many_companies for company', async () => {
    const descriptors = await generateDescriptors([
      createFlatObject({ nameSingular: 'company', namePlural: 'companies' }),
    ]);

    const mergeTool = descriptors.find(
      (descriptor) => descriptor.name === 'merge_many_companies',
    );

    if (!isDefined(mergeTool)) {
      throw new Error('merge_many_companies descriptor missing');
    }

    expect(mergeTool.executionRef).toEqual({
      kind: 'database_crud',
      objectNameSingular: 'company',
      operation: 'merge_many',
    });
    expect((mergeTool as ToolDescriptor).inputSchema).toBeDefined();
  });

  it('advertises merge_many_people for person', async () => {
    const descriptors = await generateDescriptors([
      createFlatObject({ nameSingular: 'person', namePlural: 'people' }),
    ]);

    const mergeTool = descriptors.find(
      (descriptor) => descriptor.name === 'merge_many_people',
    );

    if (!isDefined(mergeTool)) {
      throw new Error('merge_many_people descriptor missing');
    }

    expect(mergeTool.executionRef).toEqual({
      kind: 'database_crud',
      objectNameSingular: 'person',
      operation: 'merge_many',
    });
  });

  it('does not advertise merge_many for other objects', async () => {
    const descriptors = await generateDescriptors([
      createFlatObject({ nameSingular: 'task', namePlural: 'tasks' }),
      createFlatObject({ nameSingular: 'note', namePlural: 'notes' }),
    ]);

    expect(
      descriptors.some((descriptor) =>
        descriptor.name.startsWith('merge_many'),
      ),
    ).toBe(false);
  });
});

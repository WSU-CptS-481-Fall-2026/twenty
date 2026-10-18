import { Test } from '@nestjs/testing';
import { STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS } from 'twenty-shared/metadata';
import { WidgetType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { BackfillRecordCommentsTabsCommand } from 'src/database/commands/upgrade-version-command/2-41/2-41-workspace-command-1792269550103-backfill-record-comments-tabs.command';
import { computeSystemRecordPageLayoutToCreate } from 'src/engine/metadata-modules/metadata-side-effect/handlers/utils/compute-system-record-page-layout-to-create.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const WORKSPACE_ID = '20202020-0000-4000-8000-000000000001';

const setup = async (hasComments = false) => {
  const { allFlatEntityMaps } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      now: '2026-10-17T00:00:00.000Z',
      workspaceId: WORKSPACE_ID,
      twentyStandardApplicationId: '20202020-0000-4000-8000-000000000002',
    });
  const {
    flatPageLayoutMaps,
    flatPageLayoutTabMaps,
    flatPageLayoutWidgetMaps,
  } = allFlatEntityMaps;
  const companyIdentifier =
    STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.companyRecordPage
      .universalIdentifier;
  for (const identifier of Object.keys(
    flatPageLayoutMaps.byUniversalIdentifier,
  )) {
    if (identifier !== companyIdentifier) {
      delete flatPageLayoutMaps.byUniversalIdentifier[identifier];
    }
  }
  if (!hasComments) {
    for (const widget of Object.values(
      flatPageLayoutWidgetMaps.byUniversalIdentifier,
    )) {
      if (isDefined(widget) && widget.type === WidgetType.COMMENTS) {
        delete flatPageLayoutWidgetMaps.byUniversalIdentifier[
          widget.universalIdentifier
        ];
        delete flatPageLayoutTabMaps.byUniversalIdentifier[
          widget.pageLayoutTabUniversalIdentifier
        ];
      }
    }
  }
  const migrate = jest.fn().mockResolvedValue({ status: 'success' });
  const module = await Test.createTestingModule({
    providers: [
      BackfillRecordCommentsTabsCommand,
      { provide: WorkspaceIteratorService, useValue: {} },
      {
        provide: WorkspaceCacheService,
        useValue: { getOrRecompute: async () => allFlatEntityMaps },
      },
      {
        provide: WorkspaceMigrationValidateBuildAndRunService,
        useValue: { validateBuildAndRunWorkspaceMigration: migrate },
      },
    ],
  }).compile();
  const command = module.get(BackfillRecordCommentsTabsCommand);
  const run = (dryRun = false) =>
    command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options: { dryRun },
      index: 0,
      total: 1,
    });
  return { run, migrate, allFlatEntityMaps, module };
};

describe('BackfillRecordCommentsTabsCommand', () => {
  it('creates a Comments tab and widget for new custom objects', () => {
    const result = computeSystemRecordPageLayoutToCreate({
      objectMetadata: {
        universalIdentifier: '20202020-0000-4000-8000-000000000003',
        labelSingular: 'Test custom record',
      },
      applicationUniversalIdentifier: '20202020-0000-4000-8000-000000000004',
      recordPageFieldsViewUniversalIdentifier:
        '20202020-0000-4000-8000-000000000005',
    });
    const widget = result.pageLayoutWidgets.find(
      (item) => item.type === WidgetType.COMMENTS,
    );
    expect(widget).toEqual(
      expect.objectContaining({
        universalConfiguration: { configurationType: 'COMMENTS' },
      }),
    );
    expect(result.pageLayoutTabs).toContainEqual(
      expect.objectContaining({
        title: 'Comments',
        universalIdentifier: widget?.pageLayoutTabUniversalIdentifier,
        widgetUniversalIdentifiers: [widget?.universalIdentifier],
      }),
    );
  });

  it('appends a persisted tab and widget without updating existing layout customizations', async () => {
    const { run, migrate, allFlatEntityMaps, module } = await setup();
    const existingTabs = Object.values(
      allFlatEntityMaps.flatPageLayoutTabMaps.byUniversalIdentifier,
    ).filter(isDefined);
    for (const tab of existingTabs) {
      tab.position += 100;
      if (tab.title === 'Tasks') {
        tab.position = 1000;
        tab.deletedAt = '2026-10-17T00:00:00.000Z';
      }
    }
    const before = JSON.stringify(existingTabs);
    try {
      await run();
      expect(migrate).toHaveBeenCalledWith(
        expect.objectContaining({
          isSystemBuild: true,
          dryRun: false,
          allFlatEntityOperationByMetadataName: {
            pageLayoutTab: {
              flatEntityToCreate: [
                expect.objectContaining({ title: 'Comments', position: 180 }),
              ],
              flatEntityToUpdate: [],
              flatEntityToDelete: [],
            },
            pageLayoutWidget: {
              flatEntityToCreate: [
                expect.objectContaining({
                  type: WidgetType.COMMENTS,
                  universalConfiguration: { configurationType: 'COMMENTS' },
                }),
              ],
              flatEntityToUpdate: [],
              flatEntityToDelete: [],
            },
          },
        }),
      );
      expect(JSON.stringify(existingTabs)).toBe(before);
    } finally {
      await module.close();
    }
  });

  it('does nothing when a Comments widget already exists, including in a renamed tab', async () => {
    const { run, migrate, allFlatEntityMaps, module } = await setup(true);
    for (const tab of Object.values(
      allFlatEntityMaps.flatPageLayoutTabMaps.byUniversalIdentifier,
    )) {
      if (isDefined(tab)) {
        tab.title = 'My updates';
      }
    }
    try {
      await run();
      expect(migrate).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('passes dry-run through the normal metadata migration validation', async () => {
    const { run, migrate, module } = await setup();
    try {
      await run(true);
      expect(migrate).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true }),
      );
    } finally {
      await module.close();
    }
  });

  it('rejects when the metadata migration fails', async () => {
    const { run, migrate, module } = await setup();
    migrate.mockResolvedValue({ status: 'fail', error: 'Rejected' });
    try {
      await expect(run()).rejects.toThrow('Could not backfill Comments tabs');
    } finally {
      await module.close();
    }
  });
});

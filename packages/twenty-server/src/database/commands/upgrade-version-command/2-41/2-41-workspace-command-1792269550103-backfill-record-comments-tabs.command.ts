import { Command } from 'nest-commander';
import {
  getSystemPageLayoutTabUniversalIdentifier,
  getSystemPageLayoutWidgetUniversalIdentifier,
} from 'twenty-shared/application';
import { PageLayoutType, WidgetType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { computeAppendedPageLayoutTabPositions } from 'src/database/commands/upgrade-version-command/2-36/utils/compute-appended-page-layout-tab-positions.util';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { WidgetConfigurationType } from 'src/engine/metadata-modules/page-layout-widget/enums/widget-configuration-type.type';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import {
  TAB_PROPS,
  WIDGET_PROPS,
} from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-page-layout-tabs.template';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';
import { type UniversalFlatPageLayoutTab } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/types/universal-flat-page-layout-tab.type';
import { type UniversalFlatPageLayoutWidget } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/types/universal-flat-page-layout-widget.type';

type CommentsTabBackfill = {
  tabs: UniversalFlatPageLayoutTab[];
  widgets: UniversalFlatPageLayoutWidget[];
};

@RegisteredWorkspaceCommand('2.41.0', 1792269550103)
@Command({
  name: 'upgrade:2-41:backfill-record-comments-tabs',
  description:
    'Add a Comments tab and widget to existing record layouts while preserving their tabs and customizations.',
})
export class BackfillRecordCommentsTabsCommand extends ProvisionedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const {
      flatPageLayoutMaps,
      flatPageLayoutTabMaps,
      flatPageLayoutWidgetMaps,
    } = await this.workspaceCacheService.getOrRecompute(workspaceId, [
      'flatPageLayoutMaps',
      'flatPageLayoutTabMaps',
      'flatPageLayoutWidgetMaps',
    ]);
    const operationsByApplication = new Map<string, CommentsTabBackfill>();
    const now = new Date().toISOString();

    for (const layout of Object.values(
      flatPageLayoutMaps.byUniversalIdentifier,
    )) {
      if (
        !isDefined(layout) ||
        layout.type !== PageLayoutType.RECORD_PAGE ||
        !isDefined(layout.objectMetadataUniversalIdentifier) ||
        isDefined(layout.deletedAt)
      ) {
        continue;
      }

      const layoutTabs = Object.values(
        flatPageLayoutTabMaps.byUniversalIdentifier,
      )
        .filter(isDefined)
        .filter(
          (tab) =>
            tab.pageLayoutUniversalIdentifier === layout.universalIdentifier,
        );
      const tabIdentifiers = new Set(
        layoutTabs.map((tab) => tab.universalIdentifier),
      );
      const hasComments = Object.values(
        flatPageLayoutWidgetMaps.byUniversalIdentifier,
      ).some(
        (widget) =>
          isDefined(widget) &&
          widget.type === WidgetType.COMMENTS &&
          tabIdentifiers.has(widget.pageLayoutTabUniversalIdentifier),
      );
      if (hasComments) {
        continue;
      }

      const applicationUniversalIdentifier =
        layout.applicationUniversalIdentifier;
      const tabUniversalIdentifier = getSystemPageLayoutTabUniversalIdentifier({
        objectMetadataApplicationUniversalIdentifier:
          applicationUniversalIdentifier,
        pageLayoutUniversalIdentifier: layout.universalIdentifier,
        title: TAB_PROPS.comments.title,
      });
      const widgetUniversalIdentifier =
        getSystemPageLayoutWidgetUniversalIdentifier({
          objectMetadataApplicationUniversalIdentifier:
            applicationUniversalIdentifier,
          pageLayoutTabUniversalIdentifier: tabUniversalIdentifier,
          title: WIDGET_PROPS.comments.title,
        });
      const existingTab =
        flatPageLayoutTabMaps.byUniversalIdentifier[tabUniversalIdentifier];
      const operations = operationsByApplication.get(
        applicationUniversalIdentifier,
      ) ?? { tabs: [], widgets: [] };

      if (!isDefined(existingTab)) {
        const [position] = computeAppendedPageLayoutTabPositions({
          existingPageLayoutTabs: layoutTabs,
          appendedTabCount: 1,
        });

        operations.tabs.push({
          ...TAB_PROPS.comments,
          position,
          universalIdentifier: tabUniversalIdentifier,
          applicationUniversalIdentifier,
          pageLayoutUniversalIdentifier: layout.universalIdentifier,
          widgetUniversalIdentifiers: [widgetUniversalIdentifier],
          isActive: true,
          isSystemSideEffect: layout.isSystemSideEffect,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          overrides: null,
        });
      }
      operations.widgets.push({
        ...WIDGET_PROPS.comments,
        universalIdentifier: widgetUniversalIdentifier,
        applicationUniversalIdentifier,
        pageLayoutTabUniversalIdentifier: tabUniversalIdentifier,
        objectMetadataUniversalIdentifier:
          layout.objectMetadataUniversalIdentifier,
        universalConfiguration: {
          configurationType: WidgetConfigurationType.COMMENTS,
        },
        isActive: true,
        isSystemSideEffect: layout.isSystemSideEffect,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        conditionalDisplay: null,
        conditionalAvailabilityExpression: null,
        universalOverrides: null,
      });
      operationsByApplication.set(applicationUniversalIdentifier, operations);
    }

    for (const [
      applicationUniversalIdentifier,
      operations,
    ] of operationsByApplication) {
      this.logger.log(
        `${options.dryRun ? '[DRY RUN] ' : ''}Adding ${operations.tabs.length} Comments tab(s) and ${operations.widgets.length} widget(s) in workspace ${workspaceId}`,
      );
      const result =
        await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigration(
          {
            workspaceId,
            applicationUniversalIdentifier,
            isSystemBuild: true,
            dryRun: options.dryRun ?? false,
            allFlatEntityOperationByMetadataName: {
              pageLayoutTab: {
                flatEntityToCreate: operations.tabs,
                flatEntityToUpdate: [],
                flatEntityToDelete: [],
              },
              pageLayoutWidget: {
                flatEntityToCreate: operations.widgets,
                flatEntityToUpdate: [],
                flatEntityToDelete: [],
              },
            },
          },
        );
      if (result.status === 'fail') {
        throw new Error(
          `Could not backfill Comments tabs: ${JSON.stringify(result)}`,
        );
      }
    }
    if (operationsByApplication.size === 0) {
      this.logger.log(
        `No Comments tabs to backfill in workspace ${workspaceId}`,
      );
    }
  }
}

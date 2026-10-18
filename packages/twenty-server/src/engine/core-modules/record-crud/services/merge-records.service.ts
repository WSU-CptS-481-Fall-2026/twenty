import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { In, type ObjectLiteral } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { DeleteRecordService } from 'src/engine/core-modules/record-crud/services/delete-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { AttachmentWorkspaceEntity } from 'src/modules/attachment/standard-objects/attachment.workspace-entity';
import { CalendarEventParticipantWorkspaceEntity } from 'src/modules/calendar/common/standard-objects/calendar-event-participant.workspace-entity';
import { CalendarEventTargetWorkspaceEntity } from 'src/modules/calendar/common/standard-objects/calendar-event-target.workspace-entity';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { MessageThreadTargetWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-thread-target.workspace-entity';
import { NoteTargetWorkspaceEntity } from 'src/modules/note/standard-objects/note-target.workspace-entity';
import { OpportunityWorkspaceEntity } from 'src/modules/opportunity/standard-objects/opportunity.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { TaskTargetWorkspaceEntity } from 'src/modules/task/standard-objects/task-target.workspace-entity';
import { TimelineActivityWorkspaceEntity } from 'src/modules/timeline/standard-objects/timeline-activity.workspace-entity';

type MergeableObjectName = 'company' | 'person';

type MergeRecordsInput = {
  objectName: MergeableObjectName;
  ids: string[];
  conflictPriorityIndex?: number;
  dryRun?: boolean;
  authContext: WorkspaceAuthContext;
  rolePermissionConfig?: RolePermissionConfig;
};

type MergeableRecord = { id: string } & Record<string, unknown>;

type MergeRecordsResult = {
  survivorId: string;
  mergedRecord: MergeableRecord;
  losers?: string[];
  deleted?: string[];
  dryRun: boolean;
};

type RelationRepointTarget = {
  entity: new () => ObjectLiteral;
  column: string;
};

const RELATION_REPOINT_TARGETS: Record<
  MergeableObjectName,
  RelationRepointTarget[]
> = {
  company: [
    { entity: PersonWorkspaceEntity, column: 'companyId' },
    { entity: OpportunityWorkspaceEntity, column: 'companyId' },
    { entity: NoteTargetWorkspaceEntity, column: 'targetCompanyId' },
    { entity: TaskTargetWorkspaceEntity, column: 'targetCompanyId' },
    { entity: CalendarEventTargetWorkspaceEntity, column: 'targetCompanyId' },
    { entity: MessageThreadTargetWorkspaceEntity, column: 'targetCompanyId' },
    { entity: AttachmentWorkspaceEntity, column: 'targetCompanyId' },
    { entity: TimelineActivityWorkspaceEntity, column: 'targetCompanyId' },
  ],
  person: [
    { entity: OpportunityWorkspaceEntity, column: 'pointOfContactId' },
    { entity: NoteTargetWorkspaceEntity, column: 'targetPersonId' },
    { entity: TaskTargetWorkspaceEntity, column: 'targetPersonId' },
    { entity: CalendarEventTargetWorkspaceEntity, column: 'targetPersonId' },
    { entity: MessageThreadTargetWorkspaceEntity, column: 'targetPersonId' },
    { entity: AttachmentWorkspaceEntity, column: 'targetPersonId' },
    { entity: TimelineActivityWorkspaceEntity, column: 'targetPersonId' },
    { entity: MessageParticipantWorkspaceEntity, column: 'personId' },
    { entity: CalendarEventParticipantWorkspaceEntity, column: 'personId' },
  ],
};

@Injectable()
export class MergeRecordsService {
  constructor(
    private readonly findRecordsService: FindRecordsService,
    private readonly updateRecordService: UpdateRecordService,
    private readonly deleteRecordService: DeleteRecordService,
    private readonly workspaceOrmManager: WorkspaceOrmManager,
  ) {}

  async execute(
    input: MergeRecordsInput,
  ): Promise<ToolOutput<MergeRecordsResult>> {
    const {
      objectName,
      ids,
      conflictPriorityIndex = 0,
      dryRun = false,
      authContext,
      rolePermissionConfig,
    } = input;

    if (ids.length < 2) {
      throw new Error('merge_many requires at least two record ids');
    }

    const survivorId = ids[0];
    const priorityId = ids[conflictPriorityIndex];

    if (!isDefined(priorityId)) {
      throw new Error(
        `conflictPriorityIndex ${conflictPriorityIndex} is out of range for ${ids.length} ids`,
      );
    }

    const findOutput = await this.findRecordsService.execute({
      objectName,
      filter: { id: { in: ids } },
      authContext,
      rolePermissionConfig,
      shouldBuildEffectiveSelectFields: false,
    });

    if (findOutput.success !== true || !isDefined(findOutput.result)) {
      throw new Error(
        `merge_many failed to load ${objectName} records: ${findOutput.message}`,
      );
    }

    const records = findOutput.result.records as MergeableRecord[];

    if (records.length !== ids.length) {
      const foundIds = new Set(records.map((record) => record.id));
      const missingIds = ids.filter((id) => !foundIds.has(id));

      throw new Error(
        `merge_many could not find ${objectName} records: ${missingIds.join(', ')}`,
      );
    }

    const survivor = records.find((record) => record.id === survivorId);
    const priorityRecord = records.find((record) => record.id === priorityId);
    const losers = records.filter((record) => record.id !== survivorId);

    if (!isDefined(survivor) || !isDefined(priorityRecord)) {
      throw new Error(
        'merge_many could not resolve the survivor or priority record',
      );
    }

    const mergedFields = this.mergeFields(records, priorityRecord);

    if (dryRun) {
      return {
        success: true,
        message: `Dry run: no changes written. ${losers.length} ${objectName} record(s) would merge into ${survivorId}.`,
        result: {
          survivorId,
          mergedRecord: { ...survivor, ...mergedFields },
          losers: losers.map((loser) => loser.id),
          dryRun: true,
        },
      };
    }

    await this.updateRecordService.execute({
      objectName,
      objectRecordId: survivorId,
      objectRecord: mergedFields,
      fieldsToUpdate: Object.keys(mergedFields),
      authContext,
      rolePermissionConfig,
    });

    await this.repointRelations(objectName, survivorId, losers, authContext);

    for (const loser of losers) {
      await this.deleteRecordService.execute({
        objectName,
        objectRecordId: loser.id,
        authContext,
        rolePermissionConfig,
        soft: true,
      });
    }

    return {
      success: true,
      message: `Merged ${losers.length} ${objectName} record(s) into ${survivorId}.`,
      result: {
        survivorId,
        mergedRecord: { ...survivor, ...mergedFields },
        deleted: losers.map((loser) => loser.id),
        dryRun: false,
      },
    };
  }

  private mergeFields(
    records: MergeableRecord[],
    priorityRecord: MergeableRecord,
  ): Record<string, unknown> {
    const SYSTEM_FIELDS = new Set([
      'id',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ]);

    const merged: Record<string, unknown> = {};

    const fieldNames = new Set<string>();

    for (const record of records) {
      for (const fieldName of Object.keys(record)) {
        if (!SYSTEM_FIELDS.has(fieldName)) {
          fieldNames.add(fieldName);
        }
      }
    }

    for (const fieldName of fieldNames) {
      const values = records
        .map((record) => record[fieldName])
        .filter((value) => isDefined(value) && value !== null);

      if (values.length === 0) {
        continue;
      }

      if (values.some(Array.isArray)) {
        merged[fieldName] = [
          ...new Set(
            values.flatMap((value) => (Array.isArray(value) ? value : [value])),
          ),
        ];

        continue;
      }

      const priorityValue = priorityRecord[fieldName];

      merged[fieldName] =
        values.length > 1 && isDefined(priorityValue) && priorityValue !== null
          ? priorityValue
          : values[0];
    }

    return merged;
  }

  private async repointRelations(
    objectName: MergeableObjectName,
    survivorId: string,
    losers: MergeableRecord[],
    authContext: WorkspaceAuthContext,
  ): Promise<void> {
    const loserIds = losers.map((loser) => loser.id);

    if (loserIds.length === 0) {
      return;
    }

    await this.workspaceOrmManager.executeInWorkspaceContext(async () => {
      for (const { entity, column } of RELATION_REPOINT_TARGETS[objectName]) {
        const repository = this.workspaceOrmManager.getRepository(entity, {
          shouldBypassPermissionChecks: true,
        });

        await repository.update(
          { [column]: In(loserIds) },
          { [column]: survivorId },
        );
      }
    }, authContext);
  }
}

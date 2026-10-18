import { In } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';

import { DeleteRecordService } from '../delete-record.service';
import { FindRecordsService } from '../find-records.service';
import { MergeRecordsService } from '../merge-records.service';
import { UpdateRecordService } from '../update-record.service';

describe('MergeRecordsService', () => {
  let service: MergeRecordsService;
  let findRecords: { execute: jest.Mock };
  let updateRecord: { execute: jest.Mock };
  let deleteRecord: { execute: jest.Mock };
  let relationUpdates: { update: jest.Mock }[];
  let workspaceOrmManager: {
    executeInWorkspaceContext: jest.Mock;
    getRepository: jest.Mock;
  };

  const authContext = {} as WorkspaceAuthContext;

  const mockFoundRecords = (records: Record<string, unknown>[]) => {
    findRecords.execute.mockResolvedValue({
      success: true,
      message: '',
      result: { records, count: records.length, hasNextPage: false },
    });
  };

  beforeEach(() => {
    findRecords = { execute: jest.fn() };
    updateRecord = { execute: jest.fn().mockResolvedValue({ success: true }) };
    deleteRecord = { execute: jest.fn().mockResolvedValue({ success: true }) };
    relationUpdates = [];
    workspaceOrmManager = {
      executeInWorkspaceContext: jest.fn((fn: () => unknown) => fn()),
      getRepository: jest.fn(() => {
        const repository = { update: jest.fn().mockResolvedValue(undefined) };

        relationUpdates.push(repository);

        return repository;
      }),
    };

    service = new MergeRecordsService(
      findRecords as unknown as FindRecordsService,
      updateRecord as unknown as UpdateRecordService,
      deleteRecord as unknown as DeleteRecordService,
      workspaceOrmManager as unknown as WorkspaceOrmManager,
    );
  });

  describe('dryRun behavior', () => {
    it('returns merged preview and performs no writes', async () => {
      mockFoundRecords([
        { id: 'a', name: 'Alpha', tags: ['x'] },
        { id: 'b', name: 'Beta', tags: ['y'] },
      ]);

      const result = await service.execute({
        objectName: 'company',
        ids: ['a', 'b'],
        conflictPriorityIndex: 0,
        dryRun: true,
        authContext,
      });

      expect(result.success).toBe(true);
      expect(result.result?.dryRun).toBe(true);
      expect(result.result?.survivorId).toBe('a');
      expect(result.result?.losers).toEqual(['b']);
      expect(result.result?.mergedRecord).toMatchObject({
        id: 'a',
        name: 'Alpha',
        tags: ['x', 'y'],
      });
      expect(updateRecord.execute).not.toHaveBeenCalled();
      expect(deleteRecord.execute).not.toHaveBeenCalled();
      expect(
        workspaceOrmManager.executeInWorkspaceContext,
      ).not.toHaveBeenCalled();
    });
  });

  describe('field merging', () => {
    it('uses conflictPriorityIndex for scalar conflicts', async () => {
      mockFoundRecords([
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ]);

      const result = await service.execute({
        objectName: 'company',
        ids: ['a', 'b'],
        conflictPriorityIndex: 1,
        dryRun: true,
        authContext,
      });

      expect(result.result?.survivorId).toBe('a');
      expect(result.result?.mergedRecord.name).toBe('Beta');
    });

    it('unions array fields', async () => {
      mockFoundRecords([
        { id: 'a', tags: ['x'] },
        { id: 'b', tags: ['y'] },
      ]);

      const result = await service.execute({
        objectName: 'company',
        ids: ['a', 'b'],
        conflictPriorityIndex: 0,
        dryRun: true,
        authContext,
      });

      expect(result.result?.mergedRecord.tags).toEqual(['x', 'y']);
    });

    it('prefers the priority record scalar when both are set', async () => {
      mockFoundRecords([
        { id: 'a', industry: 'Tech' },
        { id: 'b', industry: 'Finance' },
      ]);

      const result = await service.execute({
        objectName: 'company',
        ids: ['a', 'b'],
        conflictPriorityIndex: 0,
        dryRun: true,
        authContext,
      });

      expect(result.result?.mergedRecord.industry).toBe('Tech');
    });

    it('rejects an out-of-range conflictPriorityIndex', async () => {
      mockFoundRecords([{ id: 'a' }, { id: 'b' }]);

      await expect(
        service.execute({
          objectName: 'company',
          ids: ['a', 'b'],
          conflictPriorityIndex: 5,
          dryRun: true,
          authContext,
        }),
      ).rejects.toThrow('out of range');
    });
  });

  describe('real merge behavior', () => {
    it('updates survivor, repoints relations, soft-deletes losers', async () => {
      mockFoundRecords([
        { id: 'a', name: 'Alpha', tags: ['x'] },
        { id: 'b', name: 'Beta', tags: ['y'] },
      ]);

      const result = await service.execute({
        objectName: 'company',
        ids: ['a', 'b'],
        conflictPriorityIndex: 0,
        dryRun: false,
        authContext,
      });

      expect(updateRecord.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          objectName: 'company',
          objectRecordId: 'a',
          objectRecord: expect.objectContaining({
            name: 'Alpha',
            tags: ['x', 'y'],
          }),
        }),
      );

      expect(deleteRecord.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          objectName: 'company',
          objectRecordId: 'b',
          soft: true,
        }),
      );

      expect(result.result?.deleted).toEqual(['b']);
    });

    it('re-points loser relations to the surviving company', async () => {
      mockFoundRecords([
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
        { id: 'c', name: 'Gamma' },
      ]);

      await service.execute({
        objectName: 'company',
        ids: ['a', 'b', 'c'],
        conflictPriorityIndex: 0,
        dryRun: false,
        authContext,
      });

      expect(workspaceOrmManager.executeInWorkspaceContext).toHaveBeenCalled();

      expect(relationUpdates).toHaveLength(8);

      for (const repository of relationUpdates) {
        expect(repository.update).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(Object),
        );
      }

      const updateCalls = relationUpdates.map(
        (repository) => repository.update.mock.calls[0],
      );

      expect(updateCalls).toContainEqual([
        { companyId: In(['b', 'c']) },
        { companyId: 'a' },
      ]);
      expect(updateCalls).toContainEqual([
        { targetCompanyId: In(['b', 'c']) },
        { targetCompanyId: 'a' },
      ]);
    });

    it('re-points loser relations to the surviving person', async () => {
      mockFoundRecords([
        { id: 'a', name: { firstName: 'Ada' } },
        { id: 'b', name: { firstName: 'Ada' } },
      ]);

      await service.execute({
        objectName: 'person',
        ids: ['a', 'b'],
        conflictPriorityIndex: 0,
        dryRun: false,
        authContext,
      });

      expect(relationUpdates).toHaveLength(9);

      const updateCalls = relationUpdates.map(
        (repository) => repository.update.mock.calls[0],
      );

      expect(updateCalls).toContainEqual([
        { pointOfContactId: In(['b']) },
        { pointOfContactId: 'a' },
      ]);
      expect(updateCalls).toContainEqual([
        { targetPersonId: In(['b']) },
        { targetPersonId: 'a' },
      ]);
      expect(updateCalls).toContainEqual([
        { personId: In(['b']) },
        { personId: 'a' },
      ]);
    });

    it('does not re-point relations on a dry run', async () => {
      mockFoundRecords([{ id: 'a' }, { id: 'b' }]);

      await service.execute({
        objectName: 'company',
        ids: ['a', 'b'],
        conflictPriorityIndex: 0,
        dryRun: true,
        authContext,
      });

      expect(
        workspaceOrmManager.executeInWorkspaceContext,
      ).not.toHaveBeenCalled();
    });
  });
});

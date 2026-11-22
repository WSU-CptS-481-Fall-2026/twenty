import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { BillingSubscriptionService } from 'src/engine/core-modules/billing/services/billing-subscription.service';
import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';
import { DnsManagerService } from 'src/engine/core-modules/dns-manager/services/dns-manager.service';
import { CustomDomainManagerService } from 'src/engine/core-modules/domain/custom-domain-manager/services/custom-domain-manager.service';
import { SubdomainManagerService } from 'src/engine/core-modules/domain/subdomain-manager/services/subdomain-manager.service';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { getQueueToken } from 'src/engine/core-modules/message-queue/utils/get-queue-token.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { WorkspaceDomainService } from 'src/engine/core-modules/workspace/services/workspace-domain.service';
import { WorkspaceActivationService } from 'src/engine/core-modules/workspace/services/workspace-activation.service';
import { WorkspaceDeletionService } from 'src/engine/core-modules/workspace/services/workspace-deletion.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';
import { WorkspaceSchemaService } from 'src/engine/workspace-datasource/workspace-schema.service';
import { WorkspaceManagerService } from 'src/engine/workspace-manager/workspace-manager.service';

describe('WorkspaceService', () => {
  let service: WorkspaceService;

  const workspaceId = 'workspace-id';
  const user = { id: 'user-id' } as AuthContextUser;
  const workspace = {
    id: workspaceId,
    activationStatus: WorkspaceActivationStatus.ACTIVE,
    subdomain: 'original',
    customDomain: null,
  } as WorkspaceEntity;
  const workspaceRepository = {
    findOneBy: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    softDelete: jest.fn(),
    delete: jest.fn(),
  };
  const userWorkspaceRepository = { find: jest.fn() };
  const cache = { invalidate: jest.fn() };
  const permissions = { userHasWorkspaceSettingPermission: jest.fn() };
  const config = { get: jest.fn() };
  const workspaceManager = { init: jest.fn() };
  const billing = { isBillingEnabled: jest.fn() };
  const subscriptions = { cancelSubscription: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const queue = { add: jest.fn() };
  const lock = { tryWithLock: jest.fn() };
  const subdomainManager = { validateSubdomainOrThrow: jest.fn() };
  const customDomainManager = { setCustomDomain: jest.fn() };
  const dnsManager = { deleteHostnameSilently: jest.fn() };
  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: { delete: jest.fn() },
  };
  const dataSource = {
    createQueryRunner: jest.fn(),
    getRepository: jest.fn(),
  };
  const flatEntityMapsCache = {
    getOrRecomputeManyOrAllFlatEntityMaps: jest.fn(),
    flushFlatEntityMaps: jest.fn(),
  };
  const workspaceSchema = { deleteWorkspaceDBSchema: jest.fn() };
  const workspaceCache = { flush: jest.fn() };

  beforeEach(async () => {
    workspaceRepository.findOneBy.mockResolvedValue({ ...workspace });
    workspaceRepository.findOne.mockResolvedValue({ ...workspace });
    workspaceRepository.save.mockImplementation(async (value) => value);
    workspaceRepository.update.mockResolvedValue({ affected: 1 });
    userWorkspaceRepository.find.mockResolvedValue([]);
    permissions.userHasWorkspaceSettingPermission.mockResolvedValue(true);
    config.get.mockReturnValue(true);
    billing.isBillingEnabled.mockReturnValue(false);
    queryRunner.manager.delete.mockResolvedValue({ affected: 0 });
    dataSource.createQueryRunner.mockReturnValue(queryRunner);
    dataSource.getRepository.mockReturnValue({
      find: jest.fn().mockResolvedValue([]),
    });
    flatEntityMapsCache.getOrRecomputeManyOrAllFlatEntityMaps.mockResolvedValue(
      {
        flatFieldMetadataMaps: { byUniversalIdentifier: {} },
      },
    );

    const module = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        WorkspaceDomainService,
        WorkspaceActivationService,
        WorkspaceDeletionService,
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: workspaceRepository,
        },
        {
          provide: getRepositoryToken(UserWorkspaceEntity),
          useValue: userWorkspaceRepository,
        },
        { provide: CoreEntityCacheService, useValue: cache },
        { provide: PermissionsService, useValue: permissions },
        { provide: TwentyConfigService, useValue: config },
        { provide: WorkspaceManagerService, useValue: workspaceManager },
        {
          provide: FeatureFlagService,
          useValue: { enableFeatureFlags: jest.fn() },
        },
        { provide: BillingService, useValue: billing },
        { provide: BillingSubscriptionService, useValue: subscriptions },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: PostgresAdvisoryLockService, useValue: lock },
        {
          provide: getQueueToken(MessageQueue.logicFunctionQueue),
          useValue: queue,
        },
        {
          provide: getQueueToken(MessageQueue.deleteCascadeQueue),
          useValue: queue,
        },
        { provide: SubdomainManagerService, useValue: subdomainManager },
        { provide: CustomDomainManagerService, useValue: customDomainManager },
        { provide: DnsManagerService, useValue: dnsManager },
        { provide: getDataSourceToken(), useValue: dataSource },
        {
          provide: WorkspaceManyOrAllFlatEntityMapsCacheService,
          useValue: flatEntityMapsCache,
        },
        { provide: WorkspaceCacheStorageService, useValue: workspaceCache },
        { provide: WorkspaceSchemaService, useValue: workspaceSchema },
      ],
    })
      .useMocker(() => ({}))
      .compile();

    service = module.get(WorkspaceService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('updateWorkspaceById', () => {
    it('saves an authorized update and invalidates the workspace cache', async () => {
      await service.updateWorkspaceById({
        payload: { id: workspaceId, displayName: 'Updated' },
        userWorkspaceId: 'membership-id',
        apiKey: undefined,
      });

      expect(workspaceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: workspaceId, displayName: 'Updated' }),
      );
      expect(cache.invalidate).toHaveBeenCalledWith(
        'workspaceEntity',
        workspaceId,
      );
    });

    it('rejects unauthorized updates before saving', async () => {
      permissions.userHasWorkspaceSettingPermission.mockResolvedValue(false);

      await expect(
        service.updateWorkspaceById({
          payload: { id: workspaceId, displayName: 'Updated' },
          userWorkspaceId: 'membership-id',
          apiKey: undefined,
        }),
      ).rejects.toThrow();
      expect(workspaceRepository.save).not.toHaveBeenCalled();
    });

    it('rejects fields that cannot be changed before activation', async () => {
      workspaceRepository.findOneBy.mockResolvedValue({
        ...workspace,
        activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
      });

      await expect(
        service.updateWorkspaceById({
          payload: { id: workspaceId, isGoogleAuthEnabled: true },
          apiKey: undefined,
        }),
      ).rejects.toThrow();
      expect(workspaceRepository.save).not.toHaveBeenCalled();
    });

    it.each([
      ['isGoogleAuthEnabled', 'AUTH_GOOGLE_ENABLED', 'Google'],
      ['isMicrosoftAuthEnabled', 'AUTH_MICROSOFT_ENABLED', 'Microsoft'],
      ['isPasswordAuthEnabled', 'AUTH_PASSWORD_ENABLED', 'Password'],
    ])(
      'rejects %s when its provider is disabled',
      async (field, configKey, name) => {
        config.get.mockImplementation((key: string) => key !== configKey);

        await expect(
          service.updateWorkspaceById({
            payload: { id: workspaceId, [field]: true },
            userWorkspaceId: 'membership-id',
            apiKey: undefined,
          }),
        ).rejects.toThrow(`${name} auth is not enabled in the system.`);
        expect(workspaceRepository.save).not.toHaveBeenCalled();
      },
    );

    it('validates changed subdomains before saving', async () => {
      await service.updateWorkspaceById({
        payload: { id: workspaceId, subdomain: 'changed' },
        userWorkspaceId: 'membership-id',
        apiKey: undefined,
      });

      expect(subdomainManager.validateSubdomainOrThrow).toHaveBeenCalledWith(
        'changed',
      );
    });

    it('removes a newly registered domain if saving fails', async () => {
      dnsManager.deleteHostnameSilently.mockResolvedValue(undefined);
      workspaceRepository.save.mockRejectedValue(new Error('save failed'));

      await expect(
        service.updateWorkspaceById({
          payload: { id: workspaceId, customDomain: 'example.com' },
          userWorkspaceId: 'membership-id',
          apiKey: undefined,
        }),
      ).rejects.toThrow('save failed');
      expect(customDomainManager.setCustomDomain).toHaveBeenCalledWith(
        expect.objectContaining({ id: workspaceId }),
        'example.com',
      );
      expect(dnsManager.deleteHostnameSilently).toHaveBeenCalledWith(
        'example.com',
      );
    });
  });

  describe('activateWorkspace', () => {
    it('returns an already active workspace when activation was already completed', async () => {
      workspaceRepository.update.mockResolvedValue({ affected: 0 });

      await expect(service.activateWorkspace(user, workspace)).resolves.toEqual(
        workspace,
      );
      expect(workspaceManager.init).not.toHaveBeenCalled();
    });

    it('rejects a workspace being activated concurrently', async () => {
      workspaceRepository.update.mockResolvedValue({ affected: 0 });
      workspaceRepository.findOneBy.mockResolvedValue({
        ...workspace,
        activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
      });

      await expect(service.activateWorkspace(user, workspace)).rejects.toThrow(
        'Workspace is already being created',
      );
      expect(workspaceManager.init).not.toHaveBeenCalled();
    });

    it('restores pending status if initialization fails', async () => {
      workspaceManager.init.mockRejectedValue(
        new Error('initialization failed'),
      );

      await expect(service.activateWorkspace(user, workspace)).rejects.toThrow(
        'initialization failed',
      );
      expect(workspaceRepository.update).toHaveBeenCalledWith(workspaceId, {
        activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
      });
      expect(cache.invalidate).toHaveBeenCalledTimes(2);
    });
  });

  describe('deleteWorkspace', () => {
    it('soft-deletes the workspace and enqueues application cleanup', async () => {
      await expect(service.deleteWorkspace(workspaceId, true)).resolves.toEqual(
        workspace,
      );

      expect(workspaceRepository.softDelete).toHaveBeenCalled();
      expect(cache.invalidate).toHaveBeenCalledWith(
        'workspaceEntity',
        workspaceId,
      );
      expect(eventEmitter.emit).toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalled();
    });

    it('refuses hard deletion when the application uninstall lock is held', async () => {
      lock.tryWithLock.mockResolvedValue({ acquired: false });

      await expect(service.deleteWorkspace(workspaceId)).rejects.toThrow(
        'while application uninstall is running',
      );
    });

    it('hard-deletes metadata and workspace data while holding the lock', async () => {
      lock.tryWithLock.mockImplementation(async (_name, run) => ({
        acquired: true,
        value: await run(),
      }));

      await expect(service.deleteWorkspace(workspaceId)).resolves.toEqual(
        workspace,
      );

      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(workspaceSchema.deleteWorkspaceDBSchema).toHaveBeenCalledWith(
        workspaceId,
      );
      expect(workspaceRepository.delete).toHaveBeenCalledWith(workspaceId);
      expect(cache.invalidate).toHaveBeenCalledWith(
        'workspaceEntity',
        workspaceId,
      );
      expect(queue.add).toHaveBeenCalledTimes(2);
    });
  });
});

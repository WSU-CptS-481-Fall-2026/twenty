import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { isNonEmptyString } from '@sniptt/guards';

import { msg } from '@lingui/core/macro';
import { isAiModelTier, type AiModelTier } from 'twenty-shared/ai';
import { PermissionFlagType } from 'twenty-shared/constants';
import {
  assertIsDefinedOrThrow,
  isAutoSelectModelId,
  isDefined,
} from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { In, IsNull, Not, Repository } from 'typeorm';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { ApiKeyEntity } from 'src/engine/core-modules/api-key/api-key.entity';
import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { FileCorePictureService } from 'src/engine/core-modules/file/file-core-picture/services/file-core-picture.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WORKSPACE_FIELDS_UPDATABLE_BEFORE_ACTIVATION } from 'src/engine/core-modules/workspace/constants/workspace-fields-updatable-before-activation.constant';
import { WorkspaceDomainService } from 'src/engine/core-modules/workspace/services/workspace-domain.service';
import { WorkspaceActivationService } from 'src/engine/core-modules/workspace/services/workspace-activation.service';
import { WorkspaceDeletionService } from 'src/engine/core-modules/workspace/services/workspace-deletion.service';
import { WORKSPACE_REACTIVATED_EVENT } from 'src/engine/core-modules/workspace/constants/workspace-reactivated-event.constant';
import { WORKSPACE_SUSPENDED_EVENT } from 'src/engine/core-modules/workspace/constants/workspace-suspended-event.constant';
import { type WorkspaceReactivatedEvent } from 'src/engine/core-modules/workspace/types/workspace-reactivated-event.type';
import { type WorkspaceSuspendedEvent } from 'src/engine/core-modules/workspace/types/workspace-suspended-event.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  WorkspaceException,
  WorkspaceExceptionCode,
  WorkspaceNotFoundDefaultError,
} from 'src/engine/core-modules/workspace/workspace.exception';
import { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import {
  PermissionsException,
  PermissionsExceptionCode,
  PermissionsExceptionMessage,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';

@Injectable()
// oxlint-disable-next-line twenty/inject-workspace-repository
export class WorkspaceService {
  private readonly WORKSPACE_FIELD_PERMISSIONS: Record<
    string,
    PermissionFlagType
  > = {
    subdomain: PermissionFlagType.WORKSPACE,
    customDomain: PermissionFlagType.WORKSPACE,
    displayName: PermissionFlagType.WORKSPACE,
    logo: PermissionFlagType.WORKSPACE,
    trashRetentionDays: PermissionFlagType.WORKSPACE,
    eventLogRetentionDays: PermissionFlagType.SECURITY,
    inviteHash: PermissionFlagType.WORKSPACE_MEMBERS,
    isPublicInviteLinkEnabled: PermissionFlagType.SECURITY,
    workspaceDiscoverability: PermissionFlagType.SECURITY,
    allowImpersonation: PermissionFlagType.SECURITY,
    isGoogleAuthEnabled: PermissionFlagType.SECURITY,
    isMicrosoftAuthEnabled: PermissionFlagType.SECURITY,
    isPasswordAuthEnabled: PermissionFlagType.SECURITY,
    editableProfileFields: PermissionFlagType.SECURITY,
    isTwoFactorAuthenticationEnforced: PermissionFlagType.SECURITY,
    defaultRoleId: PermissionFlagType.ROLES,
    aiChatModelTier: PermissionFlagType.AI_SETTINGS,
    aiAgentModelTier: PermissionFlagType.AI_SETTINGS,
    isAutoModelSelectionEnabled: PermissionFlagType.AI_SETTINGS,
    aiModelIdByTier: PermissionFlagType.AI_SETTINGS,
    aiAdditionalInstructions: PermissionFlagType.WORKSPACE,
    isInternalMessagesImportEnabled: PermissionFlagType.WORKSPACE,
  };

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly eventEmitter: EventEmitter2,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly permissionsService: PermissionsService,
    private readonly workspaceDomainService: WorkspaceDomainService,
    private readonly workspaceActivationService: WorkspaceActivationService,
    private readonly workspaceDeletionService: WorkspaceDeletionService,
    private readonly fileCorePictureService: FileCorePictureService,
    private readonly aiModelRegistryService: AiModelRegistryService,
    private readonly coreEntityCacheService: CoreEntityCacheService,
  ) {}

  // Pins are stored as given, so a stale or mistyped id must be refused here
  // rather than silently falling back to the tier default at run time. A pin
  // that is already stored is left alone so the others stay editable.
  private validateAiModelIdByTier({
    aiModelIdByTier,
    storedAiModelIdByTier,
  }: {
    aiModelIdByTier: Partial<Record<AiModelTier, string>>;
    storedAiModelIdByTier: Partial<Record<AiModelTier, string>>;
  }): void {
    for (const [tier, modelId] of Object.entries(aiModelIdByTier)) {
      if (!isAiModelTier(tier)) {
        throw new WorkspaceException(
          `Unknown AI model tier "${tier}"`,
          WorkspaceExceptionCode.AI_MODEL_PIN_NOT_VALID,
        );
      }

      if (!isNonEmptyString(modelId)) {
        throw new WorkspaceException(
          `Missing model id for tier "${tier}"`,
          WorkspaceExceptionCode.AI_MODEL_PIN_NOT_VALID,
        );
      }

      if (isAutoSelectModelId(modelId)) {
        throw new WorkspaceException(
          `Tier "${tier}" must be pinned to a concrete model`,
          WorkspaceExceptionCode.AI_MODEL_PIN_NOT_VALID,
        );
      }

      if (modelId === storedAiModelIdByTier?.[tier]) {
        continue;
      }

      if (!this.aiModelRegistryService.isModelAdminAllowed(modelId)) {
        throw new WorkspaceException(
          'Selected model has been disabled by the administrator',
          WorkspaceExceptionCode.AI_MODEL_PIN_NOT_VALID,
        );
      }

      if (!isDefined(this.aiModelRegistryService.getModelConfig(modelId))) {
        throw new WorkspaceException(
          `Model "${modelId}" is not in this instance's catalog`,
          WorkspaceExceptionCode.AI_MODEL_PIN_NOT_VALID,
        );
      }
    }
  }

  private validateAuthProviders(payload: Partial<WorkspaceEntity>): void {
    const authProvidersBySystem = {
      google: this.twentyConfigService.get('AUTH_GOOGLE_ENABLED'),
      password: this.twentyConfigService.get('AUTH_PASSWORD_ENABLED'),
      microsoft: this.twentyConfigService.get('AUTH_MICROSOFT_ENABLED'),
    };

    if (payload.isGoogleAuthEnabled && !authProvidersBySystem.google) {
      throw new WorkspaceException(
        'Google auth is not enabled in the system.',
        WorkspaceExceptionCode.ENVIRONMENT_VAR_NOT_ENABLED,
      );
    }
    if (payload.isMicrosoftAuthEnabled && !authProvidersBySystem.microsoft) {
      throw new WorkspaceException(
        'Microsoft auth is not enabled in the system.',
        WorkspaceExceptionCode.ENVIRONMENT_VAR_NOT_ENABLED,
      );
    }
    if (payload.isPasswordAuthEnabled && !authProvidersBySystem.password) {
      throw new WorkspaceException(
        'Password auth is not enabled in the system.',
        WorkspaceExceptionCode.ENVIRONMENT_VAR_NOT_ENABLED,
      );
    }
    if (payload.isGoogleAuthBypassEnabled && !authProvidersBySystem.google) {
      throw new WorkspaceException(
        'Google auth is not enabled in the system.',
        WorkspaceExceptionCode.ENVIRONMENT_VAR_NOT_ENABLED,
      );
    }
    if (
      payload.isMicrosoftAuthBypassEnabled &&
      !authProvidersBySystem.microsoft
    ) {
      throw new WorkspaceException(
        'Microsoft auth is not enabled in the system.',
        WorkspaceExceptionCode.ENVIRONMENT_VAR_NOT_ENABLED,
      );
    }
    if (
      payload.isPasswordAuthBypassEnabled &&
      !authProvidersBySystem.password
    ) {
      throw new WorkspaceException(
        'Password auth is not enabled in the system.',
        WorkspaceExceptionCode.ENVIRONMENT_VAR_NOT_ENABLED,
      );
    }
  }

  async updateWorkspaceById({
    payload,
    userWorkspaceId,
    apiKey,
  }: {
    payload: Partial<WorkspaceEntity> & { id: string };
    userWorkspaceId?: string;
    apiKey: ApiKeyEntity | undefined;
  }) {
    const workspace = await this.workspaceRepository.findOneBy({
      id: payload.id,
    });

    assertIsDefinedOrThrow(workspace, WorkspaceNotFoundDefaultError);

    await this.validateWorkspaceUpdatePermissions({
      payload,
      userWorkspaceId,
      workspaceId: workspace.id,
      apiKey,
      workspaceActivationStatus: workspace.activationStatus,
    });

    const customDomainRegistered =
      await this.workspaceDomainService.prepareWorkspaceUpdate(
        workspace,
        payload,
      );

    this.validateAuthProviders(payload);

    if (isDefined(payload.aiModelIdByTier)) {
      this.validateAiModelIdByTier({
        aiModelIdByTier: payload.aiModelIdByTier,
        storedAiModelIdByTier: workspace.aiModelIdByTier,
      });
    }

    let updatedWorkspace: WorkspaceEntity;

    try {
      updatedWorkspace = await this.workspaceRepository.save({
        ...workspace,
        ...payload,
        ...(payload.logo === null ? { logoFileId: null } : {}),
      });
    } catch (error) {
      if (payload.customDomain && customDomainRegistered) {
        this.workspaceDomainService.discardRegisteredCustomDomain(
          payload.customDomain,
        );
      }
      throw error;
    }

    await this.coreEntityCacheService.invalidate(
      'workspaceEntity',
      workspace.id,
    );

    if (payload.logo === null && isDefined(workspace.logoFileId)) {
      await this.fileCorePictureService.deleteCorePicture({
        fileId: workspace.logoFileId,
        workspaceId: workspace.id,
      });
    }

    return updatedWorkspace;
  }

  async activateWorkspace(user: AuthContextUser, workspace: WorkspaceEntity) {
    return this.workspaceActivationService.activateWorkspace(user, workspace);
  }

  async suspendWorkspace(id: string): Promise<boolean> {
    const workspaceSuspendedAt = new Date();
    const { affected } = await this.workspaceRepository.update(
      {
        id,
        activationStatus: Not(WorkspaceActivationStatus.SUSPENDED),
        deletedAt: IsNull(),
      },
      {
        activationStatus: WorkspaceActivationStatus.SUSPENDED,
        suspendedAt: workspaceSuspendedAt,
      },
    );

    const hasBeenSuspended = isDefined(affected) && affected > 0;

    if (hasBeenSuspended) {
      this.eventEmitter.emit(WORKSPACE_SUSPENDED_EVENT, {
        workspaceId: id,
      } satisfies WorkspaceSuspendedEvent);

      await this.coreEntityCacheService.invalidate('workspaceEntity', id);
    }

    return hasBeenSuspended;
  }

  async reactivateWorkspace(id: string): Promise<boolean> {
    const { affected } = await this.workspaceRepository.update(
      {
        id,
        activationStatus: In([
          WorkspaceActivationStatus.SUSPENDED,
          WorkspaceActivationStatus.CREATED,
        ]),
        deletedAt: IsNull(),
      },
      {
        activationStatus: WorkspaceActivationStatus.ACTIVE,
        suspendedAt: null,
      },
    );

    const hasBeenReactivated = isDefined(affected) && affected > 0;

    if (hasBeenReactivated) {
      this.eventEmitter.emit(WORKSPACE_REACTIVATED_EVENT, {
        workspaceId: id,
      } satisfies WorkspaceReactivatedEvent);

      await this.coreEntityCacheService.invalidate('workspaceEntity', id);
    }

    return hasBeenReactivated;
  }

  async deleteWorkspace(id: string, softDelete = false) {
    return this.workspaceDeletionService.deleteWorkspace(id, softDelete);
  }

  async enqueueWorkspaceDeletionApplicationUninstall(
    workspaceId: string,
  ): Promise<void> {
    return this.workspaceDeletionService.enqueueWorkspaceDeletionApplicationUninstall(
      workspaceId,
    );
  }

  async handleRemoveWorkspaceMember(
    workspaceId: string,
    userId: string,
    softDelete = false,
  ) {
    return this.workspaceDeletionService.handleRemoveWorkspaceMember(
      workspaceId,
      userId,
      softDelete,
    );
  }

  private async validateWorkspaceUpdatePermissions({
    payload,
    userWorkspaceId,
    workspaceId,
    apiKey,
    workspaceActivationStatus,
  }: {
    payload: Partial<WorkspaceEntity>;
    userWorkspaceId?: string;
    workspaceId: string;
    apiKey: ApiKeyEntity | undefined;
    workspaceActivationStatus: WorkspaceActivationStatus;
  }) {
    const systemFields = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt']);

    const fieldsBeingUpdated = Object.keys(payload).filter(
      (field) => !systemFields.has(field),
    );

    if (fieldsBeingUpdated.length === 0) {
      return;
    }

    if (
      workspaceActivationStatus === WorkspaceActivationStatus.PENDING_CREATION
    ) {
      const fieldsRequiringActivation = fieldsBeingUpdated.filter(
        (field) => !(field in WORKSPACE_FIELDS_UPDATABLE_BEFORE_ACTIVATION),
      );

      if (fieldsRequiringActivation.length > 0) {
        const fieldsList = fieldsRequiringActivation.join(', ');

        throw new PermissionsException(
          PermissionsExceptionMessage.PERMISSION_DENIED,
          PermissionsExceptionCode.PERMISSION_DENIED,
          {
            userFriendlyMessage: msg`These fields cannot be updated before the workspace is activated: ${fieldsList}.`,
          },
        );
      }

      return;
    }

    if (!userWorkspaceId) {
      throw new Error('Missing userWorkspaceId in authContext');
    }

    const fieldsByPermission = new Map<PermissionFlagType, string[]>();

    for (const field of fieldsBeingUpdated) {
      const requiredPermission = this.WORKSPACE_FIELD_PERMISSIONS[field];

      if (!requiredPermission) {
        throw new PermissionsException(
          `Field "${field}" is not allowed to be updated`,
          PermissionsExceptionCode.PERMISSION_DENIED,
          {
            userFriendlyMessage: msg`The field "${field}" cannot be updated. Please contact your workspace administrator.`,
          },
        );
      }

      if (!fieldsByPermission.has(requiredPermission)) {
        fieldsByPermission.set(requiredPermission, []);
      }
      fieldsByPermission.get(requiredPermission)!.push(field);
    }

    for (const [permission, fields] of fieldsByPermission.entries()) {
      const hasPermission =
        await this.permissionsService.userHasWorkspaceSettingPermission({
          userWorkspaceId,
          workspaceId,
          setting: permission,
          apiKeyId: apiKey?.id,
        });

      if (!hasPermission) {
        const fieldsList = fields.join(', ');

        throw new PermissionsException(
          PermissionsExceptionMessage.PERMISSION_DENIED,
          PermissionsExceptionCode.PERMISSION_DENIED,
          {
            userFriendlyMessage: msg`You do not have permission to update these fields: ${fieldsList}. Please contact your workspace administrator.`,
          },
        );
      }
    }
  }

  async findOneWorkspaceById(id: string) {
    return await this.workspaceRepository.findOneBy({
      id,
    });
  }
}

import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import { PermissionFlagType } from 'twenty-shared/constants';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { ApiKeyEntity } from 'src/engine/core-modules/api-key/api-key.entity';
import { WORKSPACE_FIELDS_UPDATABLE_BEFORE_ACTIVATION } from 'src/engine/core-modules/workspace/constants/workspace-fields-updatable-before-activation.constant';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  PermissionsException,
  PermissionsExceptionCode,
  PermissionsExceptionMessage,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';

@Injectable()
export class WorkspacePermissionValidationService {
  constructor(private readonly permissionsService: PermissionsService) {}

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

  async validateWorkspaceUpdatePermissions({
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
}

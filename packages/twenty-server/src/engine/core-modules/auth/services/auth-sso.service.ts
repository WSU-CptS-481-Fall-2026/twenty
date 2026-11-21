import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Injectable()
export class AuthSsoService {
  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  private getAuthProviderColumnNameByProvider(authProvider: AuthProviderEnum) {
    if (authProvider === AuthProviderEnum.Google) {
      return 'isGoogleAuthEnabled';
    }

    if (authProvider === AuthProviderEnum.Microsoft) {
      return 'isMicrosoftAuthEnabled';
    }

    if (authProvider === AuthProviderEnum.Password) {
      return 'isPasswordAuthEnabled';
    }

    throw new Error(`${authProvider} is not a valid auth provider.`);
  }

  async findWorkspaceFromWorkspaceIdOrAuthProvider(
    { authProvider, email }: { authProvider: AuthProviderEnum; email: string },
    workspaceId?: string,
  ) {
    if (
      this.twentyConfigService.get('IS_MULTIWORKSPACE_ENABLED') &&
      !workspaceId
    ) {
      // Multi-workspace enable mode but on non workspace url.
      // so get the first workspace with the current auth method enable
      const workspace = await this.workspaceRepository.findOne({
        where: {
          [this.getAuthProviderColumnNameByProvider(authProvider)]: true,
          workspaceUsers: {
            user: {
              email,
            },
          },
        },
        relations: [
          'workspaceUsers',
          'workspaceUsers.user',
          'approvedAccessDomains',
        ],
      });

      return workspace ?? undefined;
    }

    return await this.workspaceRepository.findOne({
      where: {
        id: workspaceId,
      },
      relations: ['approvedAccessDomains'],
    });
  }

  //DIFFERENT SERVICE
  async createSsoConnectedAccountIfFeatureFlagIsOn(input: {
    workspaceId: string;
    userId: string;
    handle: string;
    authProvider:
      | AuthProviderEnum.Google
      | AuthProviderEnum.Microsoft
      | AuthProviderEnum.SSO;
    oidcTokenClaims?: Record<string, unknown>;
    connectedAccountProvider?: ConnectedAccountProvider;
  }): Promise<void> {
    const provider =
      input.connectedAccountProvider ??
      this.mapAuthProviderToConnectedAccountProvider(input.authProvider);

    const scopes = this.getSsoScopes(provider);

    await this.createSsoConnectedAccountService.createOrUpdateSsoConnectedAccount(
      {
        workspaceId: input.workspaceId,
        userId: input.userId,
        handle: input.handle,
        provider,
        scopes,
        oidcTokenClaims: input.oidcTokenClaims,
      },
    );
  }

  //DIFFERENT SERVICE
  private mapAuthProviderToConnectedAccountProvider(
    authProvider:
      | AuthProviderEnum.Google
      | AuthProviderEnum.Microsoft
      | AuthProviderEnum.SSO,
  ): ConnectedAccountProvider {
    switch (authProvider) {
      case AuthProviderEnum.Google:
        return ConnectedAccountProvider.GOOGLE;
      case AuthProviderEnum.Microsoft:
        return ConnectedAccountProvider.MICROSOFT;
      case AuthProviderEnum.SSO:
        return ConnectedAccountProvider.OIDC;
      default:
        throw new Error(
          `Unsupported auth provider: ${authProvider satisfies never}`,
        );
    }
  }

  private getSsoScopes(provider: ConnectedAccountProvider): string[] {
    switch (provider) {
      case ConnectedAccountProvider.GOOGLE:
        return ['email', 'profile'];
      case ConnectedAccountProvider.MICROSOFT:
        return ['User.Read'];
      case ConnectedAccountProvider.OIDC:
        return ['openid', 'email', 'profile'];
      case ConnectedAccountProvider.SAML:
        return [];
      case ConnectedAccountProvider.IMAP_SMTP_CALDAV:
        return [];
      case ConnectedAccountProvider.EMAIL_GROUP:
      case ConnectedAccountProvider.APP:
        return [];
      default:
        throw new Error(
          `Unsupported connected account provider: ${provider satisfies never}`,
        );
    }
  }
}

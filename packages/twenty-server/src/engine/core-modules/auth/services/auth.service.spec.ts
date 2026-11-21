import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type Repository } from 'typeorm';

import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { OAuthClientRegistrationResolverService } from 'src/engine/core-modules/application/application-oauth/oauth-client-registration/oauth-client-registration-resolver.service';
import { AuthService } from 'src/engine/core-modules/auth/services/auth.service';
import { AuthSsoService } from 'src/engine/core-modules/auth/services/auth-sso.service';
import { CreateSsoConnectedAccountService } from 'src/engine/core-modules/auth/services/create-sso-connected-account.service';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { RefreshTokenService } from 'src/engine/core-modules/auth/token/services/refresh-token.service';
import { SsoExchangeTokenService } from 'src/engine/core-modules/auth/token/services/sso-exchange-token.service';
import { DomainServerConfigService } from 'src/engine/core-modules/domain/domain-server-config/services/domain-server-config.service';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { EmailService } from 'src/engine/core-modules/email/email.service';
import { EventLogEmitterService } from 'src/engine/core-modules/event-logs/emit/event-log-emitter.service';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { GuardRedirectService } from 'src/engine/core-modules/guard-redirect/services/guard-redirect.service';
import { I18nService } from 'src/engine/core-modules/i18n/i18n.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserSessionService } from 'src/engine/core-modules/user-session/services/user-session.service';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { UserService } from 'src/engine/core-modules/user/services/user.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceInvitationService } from 'src/engine/core-modules/workspace-invitation/services/workspace-invitation.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { SettingPermissionsService } from 'src/engine/permissions/setting-permissions.service';
import {
  compareHash,
  hashPassword,
} from 'src/engine/core-modules/auth/auth.util';
import { renderEmail } from 'twenty-emails';

jest.mock('src/engine/core-modules/auth/auth.util', () => ({
  ...jest.requireActual('src/engine/core-modules/auth/auth.util'),
  compareHash: jest.fn(),
  hashPassword: jest.fn(),
}));

jest.mock('twenty-emails', () => ({
  PasswordUpdateNotifyEmail: jest.fn(),
  renderEmail: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;

  let workspaceRepository: jest.Mocked<Repository<WorkspaceEntity>>;
  let userRepository: jest.Mocked<Repository<UserEntity>>;
  let appTokenRepository: jest.Mocked<Repository<AppTokenEntity>>;

  let accessTokenService: jest.Mocked<AccessTokenService>;
  let refreshTokenService: jest.Mocked<RefreshTokenService>;
  let loginTokenService: jest.Mocked<LoginTokenService>;
  let ssoExchangeTokenService: jest.Mocked<SsoExchangeTokenService>;
  let workspaceDomainsService: jest.Mocked<WorkspaceDomainsService>;
  let domainServerConfigService: jest.Mocked<DomainServerConfigService>;
  let guardRedirectService: jest.Mocked<GuardRedirectService>;
  let userWorkspaceService: jest.Mocked<UserWorkspaceService>;
  let workspaceInvitationService: jest.Mocked<WorkspaceInvitationService>;
  let authSsoService: jest.Mocked<AuthSsoService>;
  let userService: jest.Mocked<UserService>;
  let signInUpService: jest.Mocked<SignInUpService>;
  let settingPermissionsService: jest.Mocked<SettingPermissionsService>;
  let twentyConfigService: jest.Mocked<TwentyConfigService>;
  let emailService: jest.Mocked<EmailService>;
  let i18nService: jest.Mocked<I18nService>;
  let eventLogEmitterService: jest.Mocked<EventLogEmitterService>;
  let oAuthClientRegistrationResolverService: jest.Mocked<OAuthClientRegistrationResolverService>;
  let createSsoConnectedAccountService: jest.Mocked<CreateSsoConnectedAccountService>;
  let userSessionService: jest.Mocked<UserSessionService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: { findOne: jest.fn(), findOneBy: jest.fn() },
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: { findOne: jest.fn(), update: jest.fn() },
        },
        {
          provide: getRepositoryToken(AppTokenEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: AccessTokenService,
          useValue: { generateAccessToken: jest.fn() },
        },
        {
          provide: RefreshTokenService,
          useValue: { generateRefreshToken: jest.fn() },
        },
        {
          provide: LoginTokenService,
          useValue: { generateLoginToken: jest.fn() },
        },
        {
          provide: SsoExchangeTokenService,
          useValue: { generateSsoExchangeToken: jest.fn() },
        },
        {
          provide: WorkspaceDomainsService,
          useValue: {
            buildWorkspaceURL: jest.fn(),
            getWorkspaceUrls: jest.fn(),
            getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain:
              jest.fn(),
          },
        },
        {
          provide: DomainServerConfigService,
          useValue: { buildBaseUrl: jest.fn(), getBaseUrl: jest.fn() },
        },
        {
          provide: GuardRedirectService,
          useValue: { getRedirectErrorUrlAndCaptureExceptions: jest.fn() },
        },
        {
          provide: UserWorkspaceService,
          useValue: {
            addUserToWorkspaceIfUserNotInWorkspace: jest.fn(),
            checkUserWorkspaceExists: jest.fn(),
            findAvailableWorkspacesByEmail: jest.fn(),
          },
        },
        {
          provide: WorkspaceInvitationService,
          useValue: {
            getOneWorkspaceInvitation: jest.fn(),
            validatePersonalInvitation: jest.fn(),
          },
        },
        {
          provide: AuthSsoService,
          useValue: { findWorkspaceFromWorkspaceIdOrAuthProvider: jest.fn() },
        },
        {
          provide: UserService,
          useValue: {
            findUserByEmail: jest.fn(),
            findUserByEmailWithWorkspaces: jest.fn(),
            hasUserAccessToWorkspaceOrThrow: jest.fn(),
          },
        },
        {
          provide: SignInUpService,
          useValue: {
            computePartialUserFromUserPayload: jest.fn(),
            generateHash: jest.fn(),
            signInUp: jest.fn(),
            signUpWithoutWorkspace: jest.fn(),
          },
        },
        {
          provide: SettingPermissionsService,
          useValue: { userWorkspaceHasPermissionFlag: jest.fn() },
        },
        {
          provide: TwentyConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: EmailService,
          useValue: { send: jest.fn() },
        },
        {
          provide: I18nService,
          useValue: { getI18nInstance: jest.fn() },
        },
        {
          provide: EventLogEmitterService,
          useValue: { createContext: jest.fn() },
        },
        {
          provide: OAuthClientRegistrationResolverService,
          useValue: {
            resolveClient: jest.fn(),
            registerClientIdMetadataDocumentClient: jest.fn(),
            throttleClientIdMetadataDocumentFetchOrThrow: jest.fn(),
          },
        },
        {
          provide: FeatureFlagService,
          useValue: {},
        },
        {
          provide: CreateSsoConnectedAccountService,
          useValue: { createOrUpdateSsoConnectedAccount: jest.fn() },
        },
        {
          provide: UserSessionService,
          useValue: { revokeAllSessionsForUser: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(AuthService);

    workspaceRepository = module.get(getRepositoryToken(WorkspaceEntity));
    userRepository = module.get(getRepositoryToken(UserEntity));
    appTokenRepository = module.get(getRepositoryToken(AppTokenEntity));

    accessTokenService = module.get(AccessTokenService);
    refreshTokenService = module.get(RefreshTokenService);
    loginTokenService = module.get(LoginTokenService);
    ssoExchangeTokenService = module.get(SsoExchangeTokenService);
    workspaceDomainsService = module.get(WorkspaceDomainsService);
    domainServerConfigService = module.get(DomainServerConfigService);
    guardRedirectService = module.get(GuardRedirectService);
    userWorkspaceService = module.get(UserWorkspaceService);
    workspaceInvitationService = module.get(WorkspaceInvitationService);
    authSsoService = module.get(AuthSsoService);
    userService = module.get(UserService);
    signInUpService = module.get(SignInUpService);
    settingPermissionsService = module.get(SettingPermissionsService);
    twentyConfigService = module.get(TwentyConfigService);
    emailService = module.get(EmailService);
    i18nService = module.get(I18nService);
    eventLogEmitterService = module.get(EventLogEmitterService);
    oAuthClientRegistrationResolverService = module.get(
      OAuthClientRegistrationResolverService,
    );
    createSsoConnectedAccountService = module.get(
      CreateSsoConnectedAccountService,
    );
    userSessionService = module.get(UserSessionService);
  });

  describe('checkAccessAndUseInvitationOrThrow', () => {
    const user = { id: 'user-id', email: 'test@example.com' } as UserEntity;
    const workspace = { id: 'workspace-id' } as WorkspaceEntity;

    it('should validate the invitation and add the user to the workspace', async () => {
      const invitation = {
        value: 'invite-token',
        context: { roleId: 'role-id' },
      } as unknown as AppTokenEntity;

      jest
        .spyOn(userWorkspaceService, 'checkUserWorkspaceExists')
        .mockResolvedValue(false);
      jest
        .spyOn(workspaceInvitationService, 'getOneWorkspaceInvitation')
        .mockResolvedValue(invitation);

      await service['checkAccessAndUseInvitationOrThrow'](workspace, user);

      expect(
        workspaceInvitationService.getOneWorkspaceInvitation,
      ).toHaveBeenCalledWith(workspace.id, user.email);
      expect(
        workspaceInvitationService.validatePersonalInvitation,
      ).toHaveBeenCalledWith({
        workspacePersonalInviteToken: 'invite-token',
        email: user.email,
      });
      expect(
        userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace,
      ).toHaveBeenCalledWith(user, workspace, 'role-id');
    });

    it('should throw FORBIDDEN_EXCEPTION when the user is not a member and has no invitation', async () => {
      jest
        .spyOn(userWorkspaceService, 'checkUserWorkspaceExists')
        .mockResolvedValue(false);
      jest
        .spyOn(workspaceInvitationService, 'getOneWorkspaceInvitation')
        .mockResolvedValue(undefined);

      await expect(
        service['checkAccessAndUseInvitationOrThrow'](workspace, user),
      ).rejects.toMatchObject({
        code: AuthExceptionCode.FORBIDDEN_EXCEPTION,
      });

      expect(
        userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace,
      ).not.toHaveBeenCalled();
    });
  });

  describe('validateLoginWithPassword', () => {
    const input = { email: 'test@example.com', password: 'password' };
    const user = {
      id: 'user-id',
      email: input.email,
      passwordHash: 'hashed-password',
      isEmailVerified: true,
    } as UserEntity;

    it('should return the user when the credentials are valid', async () => {
      userRepository.findOne.mockResolvedValue(user);
      jest.mocked(compareHash).mockResolvedValue(true);
      twentyConfigService.get.mockReturnValue(false);

      const result = await service.validateLoginWithPassword(input);

      expect(result).toEqual(user);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: input.email },
        relations: { userWorkspaces: true },
      });
      expect(compareHash).toHaveBeenCalledWith(
        input.password,
        user.passwordHash,
      );
    });

    it('should throw FORBIDDEN_EXCEPTION when the password is wrong', async () => {
      const checkIsEmailVerifiedSpy = jest.spyOn(
        service,
        'checkIsEmailVerified',
      );

      userRepository.findOne.mockResolvedValue(user);
      jest.mocked(compareHash).mockResolvedValue(false);

      await expect(
        service.validateLoginWithPassword(input),
      ).rejects.toMatchObject({ code: AuthExceptionCode.FORBIDDEN_EXCEPTION });

      expect(checkIsEmailVerifiedSpy).not.toHaveBeenCalled();
    });
  });

  describe('checkIsEmailVerified', () => {
    it('should throw EMAIL_NOT_VERIFIED when verification is required and the email is not verified', async () => {
      twentyConfigService.get.mockReturnValue(true);

      await expect(service.checkIsEmailVerified(false)).rejects.toMatchObject({
        code: AuthExceptionCode.EMAIL_NOT_VERIFIED,
      });

      expect(twentyConfigService.get).toHaveBeenCalledWith(
        'IS_EMAIL_VERIFICATION_REQUIRED',
      );
    });
  });

  describe('verify', () => {
    const email = 'test@example.com';
    const workspaceId = 'workspace-id';
    const authProvider = AuthProviderEnum.Password;
    const user = { id: 'user-id', email, passwordHash: 'hash' } as UserEntity;

    it('should generate access and refresh tokens for an existing user', async () => {
      const accessToken = {
        token: 'access-token',
        expiresAt: new Date(),
      } as Awaited<ReturnType<AccessTokenService['generateAccessToken']>>;
      const refreshToken = {
        token: 'refresh-token',
        expiresAt: new Date(),
      } as Awaited<ReturnType<RefreshTokenService['generateRefreshToken']>>;

      userService.findUserByEmail.mockResolvedValue(user);
      accessTokenService.generateAccessToken.mockResolvedValue(accessToken);
      refreshTokenService.generateRefreshToken.mockResolvedValue(refreshToken);

      const result = await service.verify(email, workspaceId, authProvider);

      expect(result).toEqual({
        tokens: {
          accessOrWorkspaceAgnosticToken: accessToken,
          refreshToken,
        },
      });
      expect(accessTokenService.generateAccessToken).toHaveBeenCalledWith({
        userId: user.id,
        workspaceId,
        authProvider,
      });
      expect(refreshTokenService.generateRefreshToken).toHaveBeenCalledWith({
        userId: user.id,
        workspaceId,
        authProvider,
        targetedTokenType: JwtTokenTypeEnum.ACCESS,
      });
    });

    it('should throw USER_NOT_FOUND and issue no tokens when the user does not exist', async () => {
      userService.findUserByEmail.mockResolvedValue(null);

      await expect(
        service.verify(email, workspaceId, authProvider),
      ).rejects.toMatchObject({ code: AuthExceptionCode.USER_NOT_FOUND });

      expect(accessTokenService.generateAccessToken).not.toHaveBeenCalled();
      expect(refreshTokenService.generateRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe('updatePassword', () => {
    const userId = 'user-id';
    const user = {
      id: userId,
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      userWorkspaces: [{ locale: 'en' }],
    } as unknown as UserEntity;

    it('should throw INVALID_INPUT and change nothing when the password is too weak', async () => {
      userRepository.findOne.mockResolvedValue(user);

      await expect(
        service.updatePassword(userId, 'short'),
      ).rejects.toMatchObject({ code: AuthExceptionCode.INVALID_INPUT });

      expect(userRepository.update).not.toHaveBeenCalled();
      expect(appTokenRepository.update).not.toHaveBeenCalled();
      expect(
        userSessionService.revokeAllSessionsForUser,
      ).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('should update the hash, revoke tokens and sessions, and send a notification email', async () => {
      userRepository.findOne.mockResolvedValue(user);
      jest.mocked(hashPassword).mockResolvedValue('new-hash');
      jest.mocked(renderEmail).mockResolvedValue('rendered-email');
      domainServerConfigService.getBaseUrl.mockReturnValue(
        new URL('http://localhost:3000'),
      );
      i18nService.getI18nInstance.mockReturnValue({
        _: jest.fn().mockReturnValue('subject'),
      } as unknown as ReturnType<I18nService['getI18nInstance']>);
      twentyConfigService.get.mockReturnValue('Twenty');

      const result = await service.updatePassword(userId, 'ValidPass123');

      expect(result).toEqual({ success: true });
      expect(userRepository.update).toHaveBeenCalledWith(userId, {
        passwordHash: 'new-hash',
      });
      expect(appTokenRepository.update).toHaveBeenCalledWith(
        {
          userId,
          type: AppTokenType.RefreshToken,
          revokedAt: IsNull(),
        },
        { revokedAt: expect.any(Date) },
      );
      expect(userSessionService.revokeAllSessionsForUser).toHaveBeenCalledWith({
        userId,
        reason: UserSessionRevokedReason.PasswordChanged,
      });
      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: user.email, subject: 'subject' }),
      );
    });
  });
});

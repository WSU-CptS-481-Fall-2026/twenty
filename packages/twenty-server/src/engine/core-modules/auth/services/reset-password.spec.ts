import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { renderEmail } from 'twenty-emails';
import { type Repository } from 'typeorm';

import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { ResetPasswordService } from 'src/engine/core-modules/auth/services/reset-password.service';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { EmailService } from 'src/engine/core-modules/email/email.service';
import { I18nService } from 'src/engine/core-modules/i18n/i18n.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserService } from 'src/engine/core-modules/user/services/user.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

jest.mock('twenty-emails', () => ({
  PasswordResetLinkEmail: jest.fn(),
  renderEmail: jest.fn(),
}));

describe('ResetPasswordService', () => {
  let resetPasswordService: ResetPasswordService;
  let twentyConfigService: jest.Mocked<TwentyConfigService>;
  let workspaceDomainsService: jest.Mocked<WorkspaceDomainsService>;
  let workspaceRepository: jest.Mocked<Repository<WorkspaceEntity>>;
  let appTokenRepository: jest.Mocked<Repository<AppTokenEntity>>;
  let transactionalAppTokenRepository: { update: jest.Mock; save: jest.Mock };
  let emailService: jest.Mocked<EmailService>;
  let i18nService: jest.Mocked<I18nService>;
  let userService: jest.Mocked<UserService>;

  beforeEach(async () => {
    transactionalAppTokenRepository = {
      update: jest.fn(),
      save: jest.fn(),
    };

    const entityManager = {
      getRepository: jest.fn().mockReturnValue(transactionalAppTokenRepository),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResetPasswordService,
        {
          provide: TwentyConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: WorkspaceDomainsService,
          useValue: { buildWorkspaceURL: jest.fn() },
        },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(AppTokenEntity),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
            manager: {
              transaction: jest
                .fn()
                .mockImplementation(async (callback) =>
                  callback(entityManager),
                ),
            },
          },
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
          provide: UserService,
          useValue: {
            findUserByEmail: jest.fn(),
            findUserByIdOrThrow: jest.fn(),
          },
        },
      ],
    }).compile();

    resetPasswordService = module.get(ResetPasswordService);
    twentyConfigService = module.get(TwentyConfigService);
    workspaceDomainsService = module.get(WorkspaceDomainsService);
    workspaceRepository = module.get(getRepositoryToken(WorkspaceEntity));
    appTokenRepository = module.get(getRepositoryToken(AppTokenEntity));
    emailService = module.get(EmailService);
    i18nService = module.get(I18nService);
    userService = module.get(UserService);
  });

  const user = {
    id: 'user-id',
    email: 'test@example.com',
    passwordHash: 'hash',
  } as UserEntity;
  const workspace = { id: 'workspace-id' } as WorkspaceEntity;

  describe('generateAndSendPasswordResetLink', () => {
    it('should do nothing when no token could be generated', async () => {
      jest
        .spyOn(resetPasswordService, 'generatePasswordResetToken')
        .mockResolvedValue({ status: 'USER_NOT_FOUND' });
      const rotateSpy = jest.spyOn(
        resetPasswordService,
        'rotatePasswordResetToken',
      );
      const sendSpy = jest.spyOn(
        resetPasswordService,
        'sendEmailPasswordResetLink',
      );

      await resetPasswordService.generateAndSendPasswordResetLink({
        email: user.email,
        locale: 'en',
      });

      expect(rotateSpy).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('should rotate the token and send the email when a token was generated', async () => {
      const resetToken = {
        workspaceId: workspace.id,
        passwordResetToken: 'plain-token',
        passwordResetTokenExpiresAt: new Date(),
      };

      jest
        .spyOn(resetPasswordService, 'generatePasswordResetToken')
        .mockResolvedValue({
          status: 'TOKEN_GENERATED',
          resetToken,
          user,
          workspace,
        });
      const rotateSpy = jest
        .spyOn(resetPasswordService, 'rotatePasswordResetToken')
        .mockResolvedValue();
      const sendSpy = jest
        .spyOn(resetPasswordService, 'sendEmailPasswordResetLink')
        .mockResolvedValue({ success: true });

      await resetPasswordService.generateAndSendPasswordResetLink({
        email: user.email,
        locale: 'en',
      });

      expect(rotateSpy).toHaveBeenCalledWith({ userId: user.id, resetToken });
      expect(sendSpy).toHaveBeenCalledWith({
        resetToken,
        user,
        workspace,
        locale: 'en',
      });
    });
  });

  describe('generatePasswordResetToken', () => {
    it('should return USER_NOT_FOUND when the email is unknown', async () => {
      userService.findUserByEmail.mockResolvedValue(null);

      await expect(
        resetPasswordService.generatePasswordResetToken('unknown@example.com'),
      ).resolves.toEqual({ status: 'USER_NOT_FOUND' });
    });

    it('should return a token, expiry, user and workspace on success', async () => {
      userService.findUserByEmail.mockResolvedValue(user);
      workspaceRepository.findOne.mockResolvedValue(workspace);
      twentyConfigService.get.mockReturnValue('15m' as never);

      const result = await resetPasswordService.generatePasswordResetToken(
        user.email,
      );

      expect(result).toMatchObject({
        status: 'TOKEN_GENERATED',
        user,
        workspace,
        resetToken: {
          workspaceId: workspace.id,
          passwordResetToken: expect.any(String),
          passwordResetTokenExpiresAt: expect.any(Date),
        },
      });
      expect(twentyConfigService.get).toHaveBeenCalledWith(
        'PASSWORD_RESET_TOKEN_EXPIRES_IN',
      );
    });

    it('should use the requested workspace when it has password auth enabled', async () => {
      userService.findUserByEmail.mockResolvedValue(user);
      workspaceRepository.findOne.mockResolvedValue(workspace);
      twentyConfigService.get.mockReturnValue('15m' as never);

      const result = await resetPasswordService.generatePasswordResetToken(
        user.email,
        workspace.id,
      );

      expect(workspaceRepository.findOne).toHaveBeenCalledTimes(1);
      expect(workspaceRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: workspace.id,
          isPasswordAuthEnabled: true,
          workspaceUsers: { user: { id: user.id } },
        },
      });
      expect(result).toMatchObject({ status: 'TOKEN_GENERATED', workspace });
    });
  });

  describe('rotatePasswordResetToken', () => {
    it('should revoke existing tokens and save the hashed new token in a transaction', async () => {
      const resetToken = {
        workspaceId: workspace.id,
        passwordResetToken: 'plain-token',
        passwordResetTokenExpiresAt: new Date(),
      };

      await resetPasswordService.rotatePasswordResetToken({
        userId: user.id,
        resetToken,
      });

      expect(transactionalAppTokenRepository.update).toHaveBeenCalledWith(
        { userId: user.id, type: AppTokenType.PasswordResetToken },
        { revokedAt: expect.any(Date) },
      );
      expect(transactionalAppTokenRepository.save).toHaveBeenCalledWith({
        userId: user.id,
        workspaceId: workspace.id,
        value: createHash('sha256').update('plain-token').digest('hex'),
        expiresAt: resetToken.passwordResetTokenExpiresAt,
        type: AppTokenType.PasswordResetToken,
      });
    });
  });

  describe('sendEmailPasswordResetLink', () => {
    const resetToken = {
      workspaceId: workspace.id,
      passwordResetToken: 'plain-token',
      passwordResetTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    beforeEach(() => {
      workspaceDomainsService.buildWorkspaceURL.mockReturnValue(
        new URL('http://localhost:3001/reset-password/plain-token'),
      );
      jest.mocked(renderEmail).mockResolvedValue('rendered');
      i18nService.getI18nInstance.mockReturnValue({
        _: jest.fn().mockReturnValue('subject'),
      } as unknown as ReturnType<I18nService['getI18nInstance']>);
      twentyConfigService.get.mockReturnValue('Twenty' as never);
    });

    it('should send the email to a user who already has a password', async () => {
      const result = await resetPasswordService.sendEmailPasswordResetLink({
        resetToken,
        user,
        workspace,
        locale: 'en',
      });

      expect(result).toEqual({ success: true });
      expect(PasswordResetLinkEmail).toHaveBeenCalledWith(
        expect.objectContaining({ hasPassword: true, locale: 'en' }),
      );
      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: user.email, subject: 'subject' }),
      );
    });

    it('should flag hasPassword as false for a user without a password', async () => {
      await resetPasswordService.sendEmailPasswordResetLink({
        resetToken,
        user: { ...user, passwordHash: null } as unknown as UserEntity,
        workspace,
        locale: 'en',
      });

      expect(PasswordResetLinkEmail).toHaveBeenCalledWith(
        expect.objectContaining({ hasPassword: false }),
      );
    });
  });

  describe('validatePasswordResetToken', () => {
    it('should throw FORBIDDEN_EXCEPTION when the token is not found', async () => {
      appTokenRepository.findOne.mockResolvedValue(null);

      await expect(
        resetPasswordService.validatePasswordResetToken('plain-token'),
      ).rejects.toMatchObject({ code: AuthExceptionCode.FORBIDDEN_EXCEPTION });

      expect(userService.findUserByIdOrThrow).not.toHaveBeenCalled();
    });

    it('should return the user details for a valid token', async () => {
      appTokenRepository.findOne.mockResolvedValue({
        userId: user.id,
      } as AppTokenEntity);
      userService.findUserByIdOrThrow.mockResolvedValue(user);

      await expect(
        resetPasswordService.validatePasswordResetToken('plain-token'),
      ).resolves.toEqual({
        id: user.id,
        email: user.email,
        hasPassword: true,
      });
    });
  });

  describe('invalidatePasswordResetToken', () => {
    it('should revoke the reset tokens of the user', async () => {
      userService.findUserByIdOrThrow.mockResolvedValue(user);

      await expect(
        resetPasswordService.invalidatePasswordResetToken(user.id),
      ).resolves.toEqual({ success: true });

      expect(appTokenRepository.update).toHaveBeenCalledWith(
        { userId: user.id, type: AppTokenType.PasswordResetToken },
        { revokedAt: expect.any(Date) },
      );
    });
  });

});

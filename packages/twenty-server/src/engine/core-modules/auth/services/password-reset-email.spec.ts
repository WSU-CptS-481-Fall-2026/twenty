import { Test, type TestingModule } from '@nestjs/testing';

import { PasswordResetLinkEmail, renderEmail } from 'twenty-emails';

import { PasswordResetEmailService } from 'src/engine/core-modules/auth/services/password-reset-email.service';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { EmailService } from 'src/engine/core-modules/email/email.service';
import { I18nService } from 'src/engine/core-modules/i18n/i18n.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

jest.mock('twenty-emails', () => ({
  PasswordResetLinkEmail: jest.fn(),
  renderEmail: jest.fn(),
}));

describe('PasswordResetEmailService', () => {
  let passwordResetEmailService: PasswordResetEmailService;
  let twentyConfigService: jest.Mocked<TwentyConfigService>;
  let workspaceDomainsService: jest.Mocked<WorkspaceDomainsService>;
  let emailService: jest.Mocked<EmailService>;
  let i18nService: jest.Mocked<I18nService>;

  const user = {
    id: 'user-id',
    email: 'test@example.com',
    passwordHash: 'hash',
  } as UserEntity;
  const workspace = { id: 'workspace-id' } as WorkspaceEntity;
  const resetToken = {
    workspaceId: workspace.id,
    passwordResetToken: 'plain-token',
    passwordResetTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetEmailService,
        { provide: TwentyConfigService, useValue: { get: jest.fn() } },
        {
          provide: WorkspaceDomainsService,
          useValue: { buildWorkspaceURL: jest.fn() },
        },
        { provide: EmailService, useValue: { send: jest.fn() } },
        { provide: I18nService, useValue: { getI18nInstance: jest.fn() } },
      ],
    }).compile();

    passwordResetEmailService = module.get(PasswordResetEmailService);
    twentyConfigService = module.get(TwentyConfigService);
    workspaceDomainsService = module.get(WorkspaceDomainsService);
    emailService = module.get(EmailService);
    i18nService = module.get(I18nService);

    workspaceDomainsService.buildWorkspaceURL.mockReturnValue(
      new URL('http://localhost:3001/reset-password/plain-token'),
    );
    jest.mocked(renderEmail).mockResolvedValue('rendered');
    i18nService.getI18nInstance.mockReturnValue({
      _: jest.fn().mockReturnValue('subject'),
    } as unknown as ReturnType<I18nService['getI18nInstance']>);
    twentyConfigService.get.mockReturnValue('Twenty' as never);
  });

  describe('sendPasswordResetLink', () => {
    it('should send the email to a user who already has a password', async () => {
      const result = await passwordResetEmailService.sendPasswordResetLink({
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
      await passwordResetEmailService.sendPasswordResetLink({
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
});
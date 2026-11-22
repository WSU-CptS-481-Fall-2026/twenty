import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import { differenceInMilliseconds } from 'date-fns';
import ms from 'ms';
import { PasswordResetLinkEmail, renderEmail } from 'twenty-emails';
import { type APP_LOCALES } from 'twenty-shared/translations';
import { AppPath } from 'twenty-shared/types';
import { getAppPath, isDefined } from 'twenty-shared/utils';

import { type EmailPasswordResetLinkDTO } from 'src/engine/core-modules/auth/dto/email-password-reset-link.dto';
import { type PasswordResetToken } from 'src/engine/core-modules/auth/types/password-reset-token.type';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { EmailService } from 'src/engine/core-modules/email/email.service';
import { I18nService } from 'src/engine/core-modules/i18n/i18n.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Injectable()
export class PasswordResetEmailService {
  constructor(
    private readonly twentyConfigService: TwentyConfigService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
    private readonly emailService: EmailService,
    private readonly i18nService: I18nService,
  ) {}

 async sendEmailPasswordResetLink({
     resetToken,
     user,
     workspace,
     locale,
   }: {
     resetToken: PasswordResetToken;
     user: UserEntity;
     workspace: WorkspaceEntity;
     locale: keyof typeof APP_LOCALES;
   }): Promise<EmailPasswordResetLinkDTO> {
     const hasPassword = isDefined(user.passwordHash);

     const resetPasswordPath = getAppPath(AppPath.ResetPassword, {
       passwordResetToken: resetToken.passwordResetToken,
     });

     const link = this.workspaceDomainsService.buildWorkspaceURL({
       workspace,
       pathname: resetPasswordPath,
     });

     await this.sendPasswordEmail(workspace.locale);

     return { success: true };
   }

   private async sendPasswordEmail(
     locale: UserWorkspaceEntity['locale'],
     hasPassword: boolean,
     resetToken: PasswordResetToken
   ): Promise<void> {

     const emailData = {
       link: link.toString(),
       duration: ms(
         differenceInMilliseconds(
           resetToken.passwordResetTokenExpiresAt,
           new Date(),
         ),
         {
           long: true,
         },
       ),
       hasPassword,
       locale,
     };

     const emailTemplate = PasswordResetLinkEmail(emailData);

     const html = await renderEmail(emailTemplate, { pretty: true });
     const text = await renderEmail(emailTemplate, { plainText: true });

     const i18n = this.i18nService.getI18nInstance(locale);
     const subjectTemplate = hasPassword
       ? msg`Action Needed to Reset Password`
       : msg`Action Needed to Set Password`;
     const subject = i18n._(subjectTemplate);

     await this.emailService.send({
       from: `${this.twentyConfigService.get(
         'EMAIL_FROM_NAME',
       )} <${this.twentyConfigService.get('EMAIL_FROM_ADDRESS')}>`,
       to: user.email,
       subject,
       text,
       html,
     });
   }
}
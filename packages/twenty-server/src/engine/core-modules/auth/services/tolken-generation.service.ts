import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import crypto, { randomUUID } from 'node:crypto';

import { addMilliseconds } from 'date-fns';
import ms from 'ms';
import { Repository } from 'typeorm';

import {
  AppTokenEntity,
  AppTokenType,
} from 'src/engine/core-modules/app-token/app-token.entity';
import { ApplicationRegistrationService } from 'src/engine/core-modules/application/application-registration/application-registration.service';
import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { type AuthTokens } from 'src/engine/core-modules/auth/dto/auth-tokens.dto';
import { type AuthorizeAppDTO } from 'src/engine/core-modules/auth/dto/authorize-app.dto';
import { type AuthorizeAppInput } from 'src/engine/core-modules/auth/dto/authorize-app.input';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { RefreshTokenService } from 'src/engine/core-modules/auth/token/services/refresh-token.service';
import { AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { assertIssuerIsPublishedOrThrow } from 'src/engine/core-modules/auth/utils/assert-issuer-is-published.util';
import { validateRedirectUri } from 'src/engine/core-modules/auth/utils/validate-redirect-uri.util';
import { EventLogEmitterService } from 'src/engine/core-modules/event-logs/emit/event-log-emitter.service';
import { IMPERSONATION_EVENT } from 'src/engine/core-modules/event-logs/emit/events/workspace-event/impersonation/impersonation';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Injectable()
// oxlint-disable-next-line twenty/inject-workspace-repository
export class TokenGenerationService {
  constructor(
    private readonly applicationRegistrationService: ApplicationRegistrationService,
    @InjectRepository(AppTokenEntity)
    private readonly appTokenRepository: Repository<AppTokenEntity>,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly eventLogEmitterService: EventLogEmitterService,
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async generateAuthorizationCode({
    authorizeAppInput,
    user,
    workspace,
    requestBaseUrl,
  }: {
    authorizeAppInput: AuthorizeAppInput;
    user: AuthContextUser;
    workspace: WorkspaceEntity;
    requestBaseUrl: string;
  }): Promise<AuthorizeAppDTO> {
    const { clientId, codeChallenge } = authorizeAppInput;

    const applicationRegistration =
      await this.applicationRegistrationService.findOneByClientId(clientId);

    if (!applicationRegistration) {
      throw new AuthException(
        `Client not found for '${clientId}'`,
        AuthExceptionCode.CLIENT_NOT_FOUND,
      );
    }

    if (!authorizeAppInput.redirectUrl) {
      throw new AuthException(
        `redirectUrl not provided for '${clientId}'`,
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    // OAuth 2.1 / MCP auth spec: PKCE is mandatory for public clients
    // (clients registered with token_endpoint_auth_method=none, i.e. no
    // client secret hash). Confidential clients are authenticated at the
    // token endpoint instead.
    const isPublicClient = !applicationRegistration.oAuthClientSecretHash;

    if (isPublicClient && !codeChallenge) {
      throw new AuthException(
        `code_challenge is required for public clients (PKCE S256, per OAuth 2.1)`,
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    // RFC 8252 §7.3: Native apps using loopback redirect URIs may use any port.
    // When a registration has no explicit redirect URIs (e.g. the seeded CLI registration),
    // allow any loopback redirect URI.
    const hasRegisteredRedirectUris =
      applicationRegistration.oAuthRedirectUris.length > 0;

    if (hasRegisteredRedirectUris) {
      if (
        !applicationRegistration.oAuthRedirectUris.includes(
          authorizeAppInput.redirectUrl,
        )
      ) {
        throw new AuthException(
          `redirectUrl mismatch for '${clientId}'`,
          AuthExceptionCode.FORBIDDEN_EXCEPTION,
        );
      }
    } else {
      let redirectUrl: URL;

      try {
        redirectUrl = new URL(authorizeAppInput.redirectUrl);
      } catch {
        throw new AuthException(
          `Invalid redirectUrl for '${clientId}'`,
          AuthExceptionCode.FORBIDDEN_EXCEPTION,
        );
      }

      const isLoopback =
        redirectUrl.hostname === 'localhost' ||
        redirectUrl.hostname === '127.0.0.1';

      if (!isLoopback) {
        throw new AuthException(
          `redirectUrl mismatch for '${clientId}'`,
          AuthExceptionCode.FORBIDDEN_EXCEPTION,
        );
      }
    }

    const parsedScopes = authorizeAppInput.scope
      ? authorizeAppInput.scope.split(' ').filter(Boolean)
      : [];

    const requestedScopes =
      parsedScopes.length > 0
        ? parsedScopes
        : applicationRegistration.oAuthScopes;

    const invalidScopes = requestedScopes.filter(
      (scope) => !applicationRegistration.oAuthScopes.includes(scope),
    );

    if (invalidScopes.length > 0) {
      throw new AuthException(
        `Invalid scopes: ${invalidScopes.join(', ')}`,
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    const redirectUriValidation = validateRedirectUri(
      authorizeAppInput.redirectUrl,
    );

    if (!redirectUriValidation.valid) {
      throw new AuthException(
        redirectUriValidation.reason,
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    const authorizationCode = crypto.randomBytes(42).toString('hex');
    const hashedAuthorizationCode = crypto
      .createHash('sha256')
      .update(authorizationCode)
      .digest('hex');

    const expiresAt = addMilliseconds(new Date().getTime(), ms('5m'));

    const authCodeContext = {
      redirectUri: authorizeAppInput.redirectUrl,
      clientId: applicationRegistration.oAuthClientId,
      scope: requestedScopes.join(' '),
      ...(codeChallenge ? { codeChallenge } : {}),
    };

    const token = this.appTokenRepository.create({
      value: hashedAuthorizationCode,
      type: AppTokenType.AuthorizationCode,
      userId: user.id,
      workspaceId: workspace.id,
      expiresAt,
      context: authCodeContext,
    });

    await this.appTokenRepository.save(token);

    redirectUriValidation.parsed.searchParams.set('code', authorizationCode);

    const issuer = authorizeAppInput.issuer ?? requestBaseUrl;

    assertIssuerIsPublishedOrThrow({
      issuer,
      requestBaseUrl,
      serverUrl: this.twentyConfigService.get('SERVER_URL'),
    });

    redirectUriValidation.parsed.searchParams.set('iss', issuer);

    if (authorizeAppInput.state) {
      redirectUriValidation.parsed.searchParams.set(
        'state',
        authorizeAppInput.state,
      );
    }

    return { redirectUrl: redirectUriValidation.parsed.toString() };
  }

  async generateImpersonationAccessTokenAndRefreshToken({
    workspaceId,
    impersonatorUserWorkspaceId,
    impersonatedUserWorkspaceId,
    _impersonatorUserId,
    impersonatedUserId,
  }: {
    workspaceId: string;
    impersonatorUserWorkspaceId: string;
    impersonatedUserWorkspaceId: string;
    _impersonatorUserId: string;
    impersonatedUserId: string;
  }): Promise<AuthTokens> {
    const correlationId = randomUUID();

    const eventLogContext = this.eventLogEmitterService.createContext({
      workspaceId,
      userId: _impersonatorUserId,
    });

    void eventLogContext.insertWorkspaceEvent(IMPERSONATION_EVENT, {
      level: 'workspace',
      action: 'attempted',
      message: `correlationId=${correlationId}; impersonatorUserWorkspaceId=${impersonatorUserWorkspaceId}; targetUserWorkspaceId=${impersonatedUserWorkspaceId}; workspaceId=${workspaceId}`,
    });

    const accessToken = await this.accessTokenService.generateAccessToken({
      userId: impersonatedUserId,
      workspaceId,
      authProvider: AuthProviderEnum.Impersonation,
      isImpersonating: true,
      impersonatorUserWorkspaceId,
      impersonatedUserWorkspaceId,
    });
    const refreshToken = await this.refreshTokenService.generateRefreshToken(
      {
        userId: impersonatedUserId,
        workspaceId,
        authProvider: AuthProviderEnum.Impersonation,
        targetedTokenType: JwtTokenTypeEnum.ACCESS,
        isImpersonating: true,
        impersonatorUserWorkspaceId,
        impersonatedUserWorkspaceId,
      },
      true,
    );

    void eventLogContext.insertWorkspaceEvent(IMPERSONATION_EVENT, {
      level: 'workspace',
      action: 'issued',
      message: `correlationId=${correlationId}; impersonatorUserWorkspaceId=${impersonatorUserWorkspaceId}; targetUserWorkspaceId=${impersonatedUserWorkspaceId}; workspaceId=${workspaceId}`,
    });

    return {
      tokens: {
        accessOrWorkspaceAgnosticToken: accessToken,
        refreshToken,
      },
    };
  }
}

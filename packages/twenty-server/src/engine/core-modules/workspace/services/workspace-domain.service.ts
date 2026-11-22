import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { DnsManagerService } from 'src/engine/core-modules/dns-manager/services/dns-manager.service';
import { CustomDomainManagerService } from 'src/engine/core-modules/domain/custom-domain-manager/services/custom-domain-manager.service';
import { SubdomainManagerService } from 'src/engine/core-modules/domain/subdomain-manager/services/subdomain-manager.service';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Injectable()
export class WorkspaceDomainService {
  constructor(
    private readonly subdomainManagerService: SubdomainManagerService,
    private readonly customDomainManagerService: CustomDomainManagerService,
    private readonly dnsManagerService: DnsManagerService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
  ) {}

  async prepareWorkspaceUpdate(
    workspace: WorkspaceEntity,
    payload: Partial<WorkspaceEntity>,
  ): Promise<boolean> {
    if (
      isDefined(payload.subdomain) &&
      workspace.subdomain !== payload.subdomain
    ) {
      await this.subdomainManagerService.validateSubdomainOrThrow(
        payload.subdomain,
      );
    }

    if (payload.customDomain === null && isDefined(workspace.customDomain)) {
      await this.dnsManagerService.deleteHostnameSilently(
        workspace.customDomain,
      );
      workspace.isCustomDomainEnabled = false;
    }

    if (
      payload.customDomain &&
      workspace.customDomain !== payload.customDomain
    ) {
      await this.customDomainManagerService.setCustomDomain(
        workspace,
        payload.customDomain,
      );

      return true;
    }

    return false;
  }

  discardRegisteredCustomDomain(customDomain: string): void {
    this.dnsManagerService
      .deleteHostnameSilently(customDomain)
      .catch((error) => {
        this.exceptionHandlerService.captureExceptions([error]);
      });
  }
}

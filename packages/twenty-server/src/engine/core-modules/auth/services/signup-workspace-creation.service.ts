import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Repository, type QueryRunner } from 'typeorm';
import { v4 } from 'uuid';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { DEFAULT_DPA_REGION } from 'src/engine/core-modules/dpa/config/dpa-region-config.constant';
import { DpaAgreementEntity } from 'src/engine/core-modules/dpa/entities/dpa-agreement.entity';
import { DpaAgreementType } from 'src/engine/core-modules/dpa/enums/dpa-agreement-type.enum';
import { buildDpaAgreementRecord } from 'src/engine/core-modules/dpa/utils/build-dpa-agreement-record.util';
import { SubdomainManagerService } from 'src/engine/core-modules/domain/subdomain-manager/services/subdomain-manager.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Injectable()
export class SignupWorkspaceCreationService {
  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly subdomainManagerService: SubdomainManagerService,
    private readonly applicationService: ApplicationService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async createSignupWorkspace({
    workspaceId,
    workspaceCustomApplicationId,
    requestedSubdomain,
    displayName,
    email,
    isWorkEmailFound,
    queryRunner,
  }: {
    workspaceId: string;
    workspaceCustomApplicationId: string;
    requestedSubdomain: string | undefined;
    displayName: string;
    email: string;
    isWorkEmailFound: boolean;
    queryRunner: QueryRunner;
  }) {
    const workspaceToCreate = this.workspaceRepository.create({
      id: workspaceId,
      subdomain: isDefined(requestedSubdomain)
        ? requestedSubdomain
        : await this.subdomainManagerService.generateSubdomain(
            isWorkEmailFound ? { userEmail: email } : {},
          ),
      workspaceCustomApplicationId,
      displayName,
      inviteHash: v4(),
      activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
    });

    const workspace = await queryRunner.manager.save(
      WorkspaceEntity,
      workspaceToCreate,
    );

    const customApplication =
      await this.applicationService.createWorkspaceCustomApplication(
        {
          workspaceId,
          applicationId: workspaceCustomApplicationId,
        },
        queryRunner,
      );

    return { workspace, customApplication };
  }

  async recordSignupDpa({
    workspaceId,
    userId,
    email,
    queryRunner,
  }: {
    workspaceId: string;
    userId: string;
    email: string;
    queryRunner: QueryRunner;
  }): Promise<void> {
    // Click-through DPA: the DPA is incorporated by reference into the
    // ToS/signup, so acceptance = execution. Only relevant on Twenty's
    // managed cloud (multi-workspace), where Twenty is the Processor
    // hosting the data; on self-hosted deployments Twenty is not the
    // Processor, so there is nothing to record. Done atomically with
    // workspace creation so we can later prove what was agreed. (Billing
    // is an independent feature flag and must not be used to detect cloud.)
    if (this.twentyConfigService.get('IS_MULTIWORKSPACE_ENABLED') === true) {
      await queryRunner.manager.save(
        DpaAgreementEntity,
        buildDpaAgreementRecord({
          workspaceId,
          type: DpaAgreementType.CLICK_THROUGH,
          region:
            this.twentyConfigService.get('DPA_DEPLOYMENT_REGION') ??
            DEFAULT_DPA_REGION,
          acceptedAt: new Date(),
          acceptedByUserId: userId,
          acceptedByEmail: email,
        }),
      );
    }
  }
}

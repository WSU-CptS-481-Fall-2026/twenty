import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { TWENTY_ICONS_BASE_URL } from 'twenty-shared/constants';
import { isDefined } from 'twenty-shared/utils';
import { IsNull, Repository } from 'typeorm';

import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { FileCorePictureService } from 'src/engine/core-modules/file/file-core-picture/services/file-core-picture.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { getDomainFromEmailOrThrow } from 'src/utils/get-domain-from-email-or-throw';

@Injectable()
// oxlint-disable-next-line twenty/inject-workspace-repository
export class WorkspaceLogoInferenceService {
  private readonly logger = new Logger(WorkspaceLogoInferenceService.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly fileCorePictureService: FileCorePictureService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
  ) {}

  async deleteInferredWorkspaceLogo({
    fileId,
    workspaceId,
  }: {
    fileId: string;
    workspaceId: string;
  }): Promise<void> {
    try {
      await this.fileCorePictureService.deleteCorePicture({
        fileId,
        workspaceId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to clean up inferred logo for workspace ${workspaceId}`,
        error,
      );
      this.exceptionHandlerService.captureExceptions([error], {
        workspace: { id: workspaceId },
        additionalData: { source: 'inferred-workspace-logo-cleanup' },
      });
    }
  }

  async uploadInferredWorkspaceLogo({
    email,
    workspaceId,
    applicationUniversalIdentifier,
  }: {
    email: string;
    workspaceId: string;
    applicationUniversalIdentifier: string;
  }): Promise<string | undefined> {
    let uploadedLogoFileId: string | undefined;

    try {
      const logoUrl = `${TWENTY_ICONS_BASE_URL}/${getDomainFromEmailOrThrow(email)}`;
      const logoFile =
        await this.fileCorePictureService.uploadWorkspaceLogoFromUrl({
          imageUrl: logoUrl,
          workspaceId,
          applicationUniversalIdentifier,
        });

      if (!isDefined(logoFile)) {
        return;
      }

      uploadedLogoFileId = logoFile.id;

      const updateResult = await this.workspaceRepository.update(
        { id: workspaceId, logoFileId: IsNull() },
        { logoFileId: logoFile.id },
      );

      if ((updateResult.affected ?? 0) === 0) {
        await this.deleteInferredWorkspaceLogo({
          fileId: logoFile.id,
          workspaceId,
        });

        return;
      }

      return logoFile.id;
    } catch (error) {
      this.logger.error(
        `Failed to upload inferred logo for workspace ${workspaceId}`,
        error,
      );
      this.exceptionHandlerService.captureExceptions([error], {
        workspace: { id: workspaceId },
        additionalData: { source: 'inferred-workspace-logo' },
      });

      if (isDefined(uploadedLogoFileId)) {
        await this.deleteInferredWorkspaceLogo({
          fileId: uploadedLogoFileId,
          workspaceId,
        });
      }

      return;
    }
  }
}
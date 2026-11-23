import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { FileCorePictureService } from 'src/engine/core-modules/file/file-core-picture/services/file-core-picture.service';
import { WorkspaceLogoInferenceService } from 'src/engine/core-modules/workspace/services/workspace-logo-inference.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

describe('WorkspaceLogoInferenceService', () => {
  let service: WorkspaceLogoInferenceService;
  let workspaceRepository: jest.Mocked<Repository<WorkspaceEntity>>;
  let fileCorePictureService: jest.Mocked<FileCorePictureService>;
  let exceptionHandlerService: jest.Mocked<ExceptionHandlerService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceLogoInferenceService,
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: {
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: FileCorePictureService,
          useValue: {
            deleteCorePicture: jest.fn(),
            uploadWorkspaceLogoFromUrl: jest
              .fn()
              .mockResolvedValue({ id: 'logo-file-1' }),
          },
        },
        {
          provide: ExceptionHandlerService,
          useValue: {
            captureExceptions: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(WorkspaceLogoInferenceService);
    workspaceRepository = module.get(getRepositoryToken(WorkspaceEntity));
    fileCorePictureService = module.get(FileCorePictureService);
    exceptionHandlerService = module.get(ExceptionHandlerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('deleteInferredWorkspaceLogo', () => {
    it('deletes the core picture when cleanup succeeds', async () => {
      await service.deleteInferredWorkspaceLogo({
        fileId: 'logo-file-1',
        workspaceId: 'ws-1',
      });

      expect(fileCorePictureService.deleteCorePicture).toHaveBeenCalledWith({
        fileId: 'logo-file-1',
        workspaceId: 'ws-1',
      });
      expect(exceptionHandlerService.captureExceptions).not.toHaveBeenCalled();
    });

    it('captures the exception when deleting the core picture fails', async () => {
      const cleanupError = new Error('delete failed');
      fileCorePictureService.deleteCorePicture.mockRejectedValue(cleanupError);

      await expect(
        service.deleteInferredWorkspaceLogo({
          fileId: 'logo-file-1',
          workspaceId: 'ws-1',
        }),
      ).resolves.toBeUndefined();

      expect(exceptionHandlerService.captureExceptions).toHaveBeenCalledWith(
        [cleanupError],
        {
          workspace: { id: 'ws-1' },
          additionalData: { source: 'inferred-workspace-logo-cleanup' },
        },
      );
    });
  });

  describe('uploadInferredWorkspaceLogo', () => {
    it('uploads inferred logo and returns fileId when workspace logoFileId is null', async () => {
      const fileId = await service.uploadInferredWorkspaceLogo({
        email: 'founder@acme.io',
        workspaceId: 'ws-1',
        applicationUniversalIdentifier: 'app-uid-1',
      });

      expect(fileId).toBe('logo-file-1');
      expect(
        fileCorePictureService.uploadWorkspaceLogoFromUrl,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          applicationUniversalIdentifier: 'app-uid-1',
          imageUrl: expect.stringContaining('acme.io'),
        }),
      );
      expect(workspaceRepository.update).toHaveBeenCalledTimes(1);
    });

    it('cleans up uploaded logo and returns undefined when update affects 0 rows', async () => {
      workspaceRepository.update.mockResolvedValue({ affected: 0 } as never);

      const fileId = await service.uploadInferredWorkspaceLogo({
        email: 'founder@acme.io',
        workspaceId: 'ws-1',
        applicationUniversalIdentifier: 'app-uid-1',
      });

      expect(fileId).toBeUndefined();
      expect(fileCorePictureService.deleteCorePicture).toHaveBeenCalledWith({
        fileId: 'logo-file-1',
        workspaceId: 'ws-1',
      });
    });
  });
});
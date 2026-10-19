import { Test } from '@nestjs/testing';

import {
  ConnectedAccountProvider,
  FieldActorSource,
} from 'twenty-shared/types';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { CompanyWorkspaceEntity } from 'src/modules/company/standard-objects/company.workspace-entity';
import {
  CreateCompanyService,
  type CompanyToCreate,
} from 'src/modules/contact-creation-manager/services/create-company.service';

const WORKSPACE_ID = '20202020-0000-4000-8000-000000000001';
const UPDATED_AT = '2026-01-01T00:00:00.000Z';

const buildCompanyToCreate = (domainName: string): CompanyToCreate => ({
  domainName,
  createdBySource: FieldActorSource.EMAIL,
  createdByContext: { provider: ConnectedAccountProvider.GOOGLE },
});

const buildCompany = (
  overrides: Partial<CompanyWorkspaceEntity> = {},
): CompanyWorkspaceEntity =>
  Object.assign(new CompanyWorkspaceEntity(), {
    id: '20202020-0000-4000-8000-000000000002',
    domainName: {
      primaryLinkUrl: 'example.com',
      primaryLinkLabel: '',
      secondaryLinks: [],
    },
    deletedAt: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  });

describe('CreateCompanyService.createOrRestoreCompanies', () => {
  let service: CreateCompanyService;

  const secondaryDomainQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    withDeleted: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };
  const companyRepository = {
    find: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(secondaryDomainQueryBuilder),
    maximum: jest.fn(),
    save: jest.fn(),
    updateMany: jest.fn(),
  };
  const httpClient = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    companyRepository.find.mockResolvedValue([]);
    secondaryDomainQueryBuilder.getMany.mockResolvedValue([]);
    companyRepository.maximum.mockResolvedValue(4);
    companyRepository.save.mockResolvedValue([]);
    companyRepository.updateMany.mockResolvedValue({ raw: [] });
    httpClient.get.mockResolvedValue({
      data: { name: 'New company', city: 'Paris' },
    });

    const module = await Test.createTestingModule({
      providers: [
        CreateCompanyService,
        {
          provide: WorkspaceOrmManager,
          useValue: {
            executeInWorkspaceContext: (callback: () => Promise<unknown>) =>
              callback(),
            getRepository: () => companyRepository,
          },
        },
        {
          provide: SecureHttpClientService,
          useValue: { getHttpClient: () => httpClient },
        },
      ],
    }).compile();

    service = module.get(CreateCompanyService);
  });

  it.each(['primary', 'secondary'])(
    'should reuse a live %s domain match without writing the company',
    async (link) => {
      const company = buildCompany({
        domainName: {
          primaryLinkUrl: 'example.com',
          primaryLinkLabel: '',
          secondaryLinks: [{ url: 'alias.com', label: '' }],
        },
      });
      const domainName = link === 'primary' ? 'example.com' : 'alias.com';

      if (link === 'primary') {
        companyRepository.find.mockResolvedValue([company]);
      } else {
        secondaryDomainQueryBuilder.getMany.mockResolvedValue([company]);
      }

      const result = await service.createOrRestoreCompanies(
        [buildCompanyToCreate(domainName)],
        WORKSPACE_ID,
      );

      expect(result[domainName]).toBe(company.id);
      expect(companyRepository.updateMany).not.toHaveBeenCalled();
      expect(companyRepository.save).not.toHaveBeenCalled();
      expect(company.updatedAt).toBe(UPDATED_AT);
      expect(companyRepository.maximum).not.toHaveBeenCalled();
      expect(httpClient.get).not.toHaveBeenCalled();
    },
  );

  it.each(['primary', 'secondary'])(
    'should restore a deleted %s domain match with its existing identity',
    async (link) => {
      const company = buildCompany({
        deletedAt: '2026-02-01T00:00:00.000Z',
        domainName: {
          primaryLinkUrl: 'example.com',
          primaryLinkLabel: '',
          secondaryLinks: [{ url: 'alias.com', label: '' }],
        },
      });
      const domainName = link === 'primary' ? 'example.com' : 'alias.com';

      if (link === 'primary') {
        companyRepository.find.mockResolvedValue([company]);
      } else {
        secondaryDomainQueryBuilder.getMany.mockResolvedValue([company]);
      }

      const result = await service.createOrRestoreCompanies(
        [buildCompanyToCreate(domainName)],
        WORKSPACE_ID,
      );

      expect(result[domainName]).toBe(company.id);
      expect(companyRepository.updateMany).toHaveBeenCalledWith([
        { criteria: company.id, partialEntity: { deletedAt: null } },
      ]);
      expect(companyRepository.save).toHaveBeenCalledWith([]);
      expect(httpClient.get).not.toHaveBeenCalled();
    },
  );

  it('should prefer a live secondary match over a deleted primary match without restoring either', async () => {
    const deletedCompany = buildCompany({
      deletedAt: '2026-02-01T00:00:00.000Z',
    });
    const liveCompany = buildCompany({
      id: '20202020-0000-4000-8000-000000000003',
      domainName: {
        primaryLinkUrl: 'other.com',
        primaryLinkLabel: '',
        secondaryLinks: [{ url: 'example.com', label: '' }],
      },
    });

    companyRepository.find.mockResolvedValue([deletedCompany]);
    secondaryDomainQueryBuilder.getMany.mockResolvedValue([liveCompany]);

    const result = await service.createOrRestoreCompanies(
      [buildCompanyToCreate('example.com')],
      WORKSPACE_ID,
    );

    expect(result['example.com']).toBe(liveCompany.id);
    expect(companyRepository.updateMany).not.toHaveBeenCalled();
    expect(companyRepository.save).not.toHaveBeenCalled();
  });

  it('should create new companies and restore deleted companies in a batch without updating live matches', async () => {
    const liveCompany = buildCompany();
    const deletedCompany = buildCompany({
      id: '20202020-0000-4000-8000-000000000003',
      domainName: {
        primaryLinkUrl: 'deleted.com',
        primaryLinkLabel: '',
        secondaryLinks: [],
      },
      deletedAt: '2026-02-01T00:00:00.000Z',
    });
    const newCompany = buildCompany({
      id: '20202020-0000-4000-8000-000000000004',
      domainName: {
        primaryLinkUrl: 'new.com',
        primaryLinkLabel: '',
        secondaryLinks: [],
      },
    });

    companyRepository.find.mockResolvedValue([liveCompany, deletedCompany]);
    companyRepository.save.mockResolvedValue([newCompany]);

    const result = await service.createOrRestoreCompanies(
      ['example.com', 'deleted.com', 'new.com'].map(buildCompanyToCreate),
      WORKSPACE_ID,
    );

    expect(result).toEqual({
      'example.com': liveCompany.id,
      'deleted.com': deletedCompany.id,
      'new.com': newCompany.id,
    });
    expect(companyRepository.updateMany).toHaveBeenCalledWith([
      { criteria: deletedCompany.id, partialEntity: { deletedAt: null } },
    ]);
    expect(companyRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'New company',
        domainName: { primaryLinkUrl: 'new.com' },
        address: { addressCity: 'Paris' },
        position: 5,
        createdBy: expect.objectContaining({ source: FieldActorSource.EMAIL }),
      }),
    ]);
    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(httpClient.get).toHaveBeenCalledWith('/new.com');
  });
});

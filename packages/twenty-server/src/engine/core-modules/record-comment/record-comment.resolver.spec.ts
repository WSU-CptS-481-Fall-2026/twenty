import { type INestApplication } from '@nestjs/common';
import { GraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';

import { YogaDriver, type YogaDriverConfig } from '@graphql-yoga/nestjs';
import { type GraphQLSchema, graphql } from 'graphql';

import { RecordCommentResolver } from 'src/engine/core-modules/record-comment/record-comment.resolver';
import { RecordCommentService } from 'src/engine/core-modules/record-comment/record-comment.service';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';

const record = {
  objectMetadataId: '11111111-1111-4111-8111-111111111111',
  recordId: '22222222-2222-4222-8222-222222222222',
};
const comment = {
  id: '33333333-3333-4333-8333-333333333333',
  body: 'A record update',
  ...record,
};
const workspaceMemberId = '44444444-4444-4444-8444-444444444444';
const createMutation = `
  mutation CreateRecordComment($input: CreateRecordCommentInput!) {
    createRecordComment(input: $input) { id body }
  }
`;
const listQuery = `
  query RecordComments($input: RecordCommentsInput!) {
    recordComments(input: $input) { comments { id } }
  }
`;

describe('RecordCommentResolver input validation', () => {
  let app: INestApplication;
  let schema: GraphQLSchema;
  const recordCommentService = {
    create: jest.fn().mockResolvedValue(comment),
    list: jest.fn().mockResolvedValue({ comments: [], nextCursor: null }),
    delete: jest.fn().mockResolvedValue(true),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<YogaDriverConfig>({
          driver: YogaDriver,
          autoSchemaFile: true,
        }),
      ],
      providers: [
        RecordCommentResolver,
        { provide: RecordCommentService, useValue: recordCommentService },
      ],
    })
      .overrideGuard(WorkspaceAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CustomPermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    schema = app.get<GraphQLSchemaHost>(GraphQLSchemaHost).schema;
  });

  afterAll(async () => {
    await app.close();
  });

  it('passes a valid comment to the service', async () => {
    const result = await graphql({
      schema,
      source: createMutation,
      variableValues: { input: comment },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.createRecordComment).toEqual({
      id: comment.id,
      body: comment.body,
    });
    expect(recordCommentService.create).toHaveBeenCalledWith(comment);
  });

  it.each([20, 21])(
    'enforces the mention limit for %i mentions',
    async (count) => {
      const input = {
        ...comment,
        body: '@A '.repeat(count),
        mentions: Array.from({ length: count }, (_, index) => ({
          workspaceMemberId,
          start: index * 3,
          end: index * 3 + 2,
        })),
      };
      const result = await graphql({
        schema,
        source: createMutation,
        variableValues: { input },
      });

      if (count === 20) {
        expect(result.errors).toBeUndefined();
        expect(recordCommentService.create).toHaveBeenCalledWith(input);
      } else {
        expect(result.errors?.[0]?.message).toContain(
          'mentions must contain no more than 20 elements',
        );
        expect(recordCommentService.create).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    { start: -1, end: 2, message: 'start must not be less than 0' },
    { start: 0, end: 5001, message: 'end must not be greater than 5000' },
  ])(
    'rejects invalid nested mention offsets: $message',
    async ({ start, end, message }) => {
      const result = await graphql({
        schema,
        source: createMutation,
        variableValues: {
          input: {
            ...comment,
            mentions: [{ workspaceMemberId, start, end }],
          },
        },
      });

      expect(result.errors?.[0]?.message).toContain(message);
      expect(recordCommentService.create).not.toHaveBeenCalled();
    },
  );

  it('rejects a page size above the limit before querying comments', async () => {
    const result = await graphql({
      schema,
      source: listQuery,
      variableValues: { input: { ...record, pageSize: 51 } },
    });

    expect(result.errors?.[0]?.message).toContain(
      'pageSize must not be greater than 50',
    );
    expect(recordCommentService.list).not.toHaveBeenCalled();
  });

  it('uses the schema default when the page size is omitted', async () => {
    const result = await graphql({
      schema,
      source: listQuery,
      variableValues: { input: record },
    });

    expect(result.errors).toBeUndefined();
    expect(recordCommentService.list).toHaveBeenCalledWith({
      ...record,
      pageSize: 10,
    });
  });
});

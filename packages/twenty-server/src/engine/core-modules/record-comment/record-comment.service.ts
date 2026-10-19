import { isNonEmptyString } from '@sniptt/guards';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { isDefined, isNonEmptyArray } from 'twenty-shared/utils';

import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  type CreateRecordCommentInput,
  type DeleteRecordCommentInput,
  type RecordCommentRecordInput,
  type RecordCommentsInput,
} from 'src/engine/core-modules/record-comment/record-comment.dto';
import { RecordCommentEntity } from 'src/engine/core-modules/record-comment/record-comment.entity';
import { RecordCommentTargetEntity } from 'src/engine/core-modules/record-comment/record-comment-target.entity';
import { type RecordCommentMention } from 'src/engine/core-modules/record-comment/record-comment-mention.type';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { getWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { resolveRolePermissionConfig } from 'src/engine/twenty-orm/utils/resolve-role-permission-config.util';
import { type WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

@Injectable()
export class RecordCommentService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly workspaceOrmManager: WorkspaceOrmManager,
  ) {}

  private async authorizeRecord(
    input: RecordCommentRecordInput,
  ): Promise<UserWorkspaceAuthContext> {
    const authContext = getWorkspaceAuthContext();

    if (authContext.type !== 'user') {
      throw new ForbiddenException('Comments require a workspace member.');
    }

    const objectMetadata = await this.dataSource
      .getRepository(ObjectMetadataEntity)
      .findOneBy({
        id: input.objectMetadataId,
        workspaceId: authContext.workspace.id,
        isActive: true,
      });

    if (!isDefined(objectMetadata)) {
      throw new NotFoundException('Record is unavailable.');
    }

    await this.workspaceOrmManager.executeInWorkspaceContext(async () => {
      const context = getWorkspaceContext();
      const permissionConfig = resolveRolePermissionConfig({
        authContext,
        userWorkspaceRoleMap: context.userWorkspaceRoleMap,
        apiKeyRoleMap: context.apiKeyRoleMap,
      });

      if (!isDefined(permissionConfig)) {
        throw new ForbiddenException('Record is unavailable.');
      }

      const record = await this.workspaceOrmManager
        .getRepository(objectMetadata.nameSingular, permissionConfig)
        .findOne({
          where: { id: input.recordId },
          select: { id: true },
        });

      if (!isDefined(record)) {
        throw new NotFoundException('Record is unavailable.');
      }
    }, authContext);

    return authContext;
  }

  async list(input: RecordCommentsInput) {
    const authContext = await this.authorizeRecord(input);
    const { pageSize } = input;

    const query = this.dataSource
      .getRepository(RecordCommentEntity)
      .createQueryBuilder('comment')
      .innerJoin(
        RecordCommentTargetEntity,
        'target',
        'target.commentId = comment.id AND target.workspaceId = comment.workspaceId',
      )
      .where('comment.workspaceId = :workspaceId', {
        workspaceId: authContext.workspace.id,
      })
      .andWhere(
        'target.objectMetadataId = :objectMetadataId AND target.recordId = :recordId',
        { objectMetadataId: input.objectMetadataId, recordId: input.recordId },
      )
      .orderBy('comment.createdAt', 'DESC')
      .addOrderBy('comment.id', 'DESC')
      .take(pageSize + 1);

    if (isDefined(input.cursor)) {
      query.andWhere('(comment.createdAt, comment.id) < (:createdAt, :id)', {
        createdAt: input.cursor.createdAt,
        id: input.cursor.id,
      });
    }

    const rows = await query.getMany();
    const comments = rows
      .slice(0, pageSize)
      .map((comment) => this.toDTO(comment, authContext));
    const lastComment = comments[comments.length - 1];

    return {
      comments,
      nextCursor:
        rows.length > pageSize && isDefined(lastComment)
          ? { id: lastComment.id, createdAt: lastComment.createdAt }
          : null,
    };
  }

  async create(input: CreateRecordCommentInput) {
    const authContext = await this.authorizeRecord(input);
    const body = input.body.trim();

    if (body.length === 0 || body.length > 5000) {
      throw new BadRequestException(
        'Comments must contain 1 to 5000 characters.',
      );
    }

    const mentions = await this.resolveMentions(input, body, authContext);

    const comment = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RecordCommentEntity);
      const result = await repository
        .createQueryBuilder()
        .insert()
        .values({
          id: input.id,
          workspaceId: authContext.workspace.id,
          body,
          mentions,
          authorUserId: authContext.user.id,
          authorWorkspaceMemberId: authContext.workspaceMemberId,
          authorName: [
            authContext.workspaceMember.name.firstName,
            authContext.workspaceMember.name.lastName,
          ]
            .filter(isNonEmptyString)
            .join(' '),
        })
        .orIgnore()
        .returning('id')
        .execute();

      if (isNonEmptyArray(result.raw)) {
        await manager.getRepository(RecordCommentTargetEntity).insert({
          workspaceId: authContext.workspace.id,
          commentId: input.id,
          objectMetadataId: input.objectMetadataId,
          recordId: input.recordId,
        });
      }

      const savedComment = await repository.findOneBy({
        id: input.id,
        workspaceId: authContext.workspace.id,
      });
      const target = await manager
        .getRepository(RecordCommentTargetEntity)
        .findOneBy({
          commentId: input.id,
          workspaceId: authContext.workspace.id,
          objectMetadataId: input.objectMetadataId,
          recordId: input.recordId,
        });

      if (
        !isDefined(savedComment) ||
        !isDefined(target) ||
        savedComment.authorUserId !== authContext.user.id ||
        savedComment.body !== body ||
        savedComment.mentions.length !== mentions.length ||
        savedComment.mentions.some(
          (mention, index) =>
            mention.workspaceMemberId !== mentions[index].workspaceMemberId ||
            mention.start !== mentions[index].start ||
            mention.end !== mentions[index].end ||
            mention.label !== mentions[index].label,
        )
      ) {
        throw new BadRequestException(
          'This submission id has already been used.',
        );
      }

      return savedComment;
    });

    return this.toDTO(comment, authContext);
  }

  private async resolveMentions(
    input: CreateRecordCommentInput,
    body: string,
    authContext: UserWorkspaceAuthContext,
  ): Promise<RecordCommentMention[]> {
    if (!isNonEmptyArray(input.mentions)) {
      return [];
    }

    const leadingWhitespaceLength =
      input.body.length - input.body.trimStart().length;
    const mentions = input.mentions
      .map((mention) => ({
        ...mention,
        start: mention.start - leadingWhitespaceLength,
        end: mention.end - leadingWhitespaceLength,
      }))
      .sort((first, second) => first.start - second.start);

    if (
      mentions.some(
        (mention, index) =>
          mention.start < 0 ||
          mention.end <= mention.start ||
          mention.end > body.length ||
          (index > 0 && mention.start < mentions[index - 1].end),
      )
    ) {
      throw new BadRequestException('Mention positions are invalid.');
    }

    const members = await this.workspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const context = getWorkspaceContext();
        const permissionConfig = resolveRolePermissionConfig({
          authContext,
          userWorkspaceRoleMap: context.userWorkspaceRoleMap,
          apiKeyRoleMap: context.apiKeyRoleMap,
        });

        if (!isDefined(permissionConfig)) {
          throw new ForbiddenException('Mentions are unavailable.');
        }

        return this.workspaceOrmManager
          .getRepository<WorkspaceMemberWorkspaceEntity>(
            'workspaceMember',
            permissionConfig,
          )
          .find({
            where: {
              id: In(mentions.map((mention) => mention.workspaceMemberId)),
            },
          });
      },
      authContext,
    );

    const activeMemberships =
      members.length > 0
        ? await this.dataSource.getRepository(UserWorkspaceEntity).find({
            where: {
              workspaceId: authContext.workspace.id,
              userId: In(members.map((member) => member.userId)),
            },
            select: { userId: true },
          })
        : [];

    return mentions.map((mention) => {
      const member = members.find(
        (candidate) => candidate.id === mention.workspaceMemberId,
      );
      if (
        !isDefined(member) ||
        !activeMemberships.some(
          (membership) => membership.userId === member.userId,
        )
      ) {
        throw new BadRequestException(
          'Mentioned member is unavailable in this workspace.',
        );
      }
      const label = [member.name.firstName, member.name.lastName]
        .filter(isNonEmptyString)
        .join(' ');
      if (body.slice(mention.start, mention.end) !== `@${label}`) {
        throw new BadRequestException(
          'Mention text does not match the selected member.',
        );
      }
      return {
        workspaceMemberId: member.id,
        label,
        start: mention.start,
        end: mention.end,
      };
    });
  }

  async delete(input: DeleteRecordCommentInput) {
    const authContext = await this.authorizeRecord(input);

    return this.dataSource.transaction(async (manager) => {
      const target = await manager
        .getRepository(RecordCommentTargetEntity)
        .findOneBy({
          workspaceId: authContext.workspace.id,
          commentId: input.commentId,
          objectMetadataId: input.objectMetadataId,
          recordId: input.recordId,
        });

      if (!isDefined(target)) {
        throw new NotFoundException('Comment is unavailable.');
      }

      const result = await manager.getRepository(RecordCommentEntity).delete({
        id: input.commentId,
        workspaceId: authContext.workspace.id,
        authorUserId: authContext.user.id,
      });

      if (result.affected !== 1) {
        throw new ForbiddenException(
          'Only the author can delete this comment.',
        );
      }

      return true;
    });
  }

  private toDTO(
    comment: RecordCommentEntity,
    authContext: UserWorkspaceAuthContext,
  ) {
    return {
      id: comment.id,
      body: comment.body,
      mentions: comment.mentions,
      authorWorkspaceMemberId: comment.authorWorkspaceMemberId,
      authorName: comment.authorName,
      createdAt: comment.createdAt,
      canDelete: comment.authorUserId === authContext.user.id,
    };
  }
}

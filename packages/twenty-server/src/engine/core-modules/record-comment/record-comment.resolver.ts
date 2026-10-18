import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { CoreResolver } from 'src/engine/api/graphql/graphql-config/decorators/core-resolver.decorator';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import {
  CreateRecordCommentInput,
  DeleteRecordCommentInput,
  RecordCommentDTO,
  RecordCommentPageDTO,
  RecordCommentsInput,
} from 'src/engine/core-modules/record-comment/record-comment.dto';
import { RecordCommentService } from 'src/engine/core-modules/record-comment/record-comment.service';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';

@UseGuards(WorkspaceAuthGuard, UserAuthGuard, CustomPermissionGuard)
@UsePipes(ResolverValidationPipe)
@CoreResolver(() => RecordCommentDTO)
export class RecordCommentResolver {
  constructor(private readonly recordCommentService: RecordCommentService) {}

  @Query(() => RecordCommentPageDTO)
  recordComments(@Args('input') input: RecordCommentsInput) {
    return this.recordCommentService.list(input);
  }

  @Mutation(() => RecordCommentDTO)
  createRecordComment(@Args('input') input: CreateRecordCommentInput) {
    return this.recordCommentService.create(input);
  }

  @Mutation(() => Boolean)
  deleteRecordComment(@Args('input') input: DeleteRecordCommentInput) {
    return this.recordCommentService.delete(input);
  }
}

import {
  Field,
  GraphQLISODateTime,
  InputType,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { type RecordCommentMention } from 'src/engine/core-modules/record-comment/record-comment-mention.type';

@InputType()
export class RecordCommentMentionInput {
  @Field(() => UUIDScalarType)
  @IsUUID()
  workspaceMemberId: string;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  @Max(5000)
  start: number;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(5000)
  end: number;
}

@ObjectType('RecordCommentMention')
export class RecordCommentMentionDTO implements RecordCommentMention {
  @Field(() => UUIDScalarType)
  workspaceMemberId: string;

  @Field()
  label: string;

  @Field(() => Int)
  start: number;

  @Field(() => Int)
  end: number;
}

@InputType()
export class RecordCommentRecordInput {
  @Field(() => UUIDScalarType)
  @IsUUID()
  objectMetadataId: string;

  @Field(() => UUIDScalarType)
  @IsUUID()
  recordId: string;
}

@ObjectType('RecordCommentCursor')
@InputType('RecordCommentCursorInput')
export class RecordCommentCursorDTO {
  @Field(() => GraphQLISODateTime)
  @IsDate()
  createdAt: Date;

  @Field(() => UUIDScalarType)
  @IsUUID()
  id: string;
}

@InputType()
export class RecordCommentsInput extends RecordCommentRecordInput {
  @Field(() => Int, { defaultValue: 10 })
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 10;

  @Field(() => RecordCommentCursorDTO, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => RecordCommentCursorDTO)
  cursor?: RecordCommentCursorDTO;
}

@InputType()
export class CreateRecordCommentInput extends RecordCommentRecordInput {
  @Field(() => UUIDScalarType)
  @IsUUID()
  id: string;

  @Field()
  @MaxLength(5000)
  body: string;

  @Field(() => [RecordCommentMentionInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RecordCommentMentionInput)
  mentions?: RecordCommentMentionInput[];
}

@InputType()
export class DeleteRecordCommentInput extends RecordCommentRecordInput {
  @Field(() => UUIDScalarType)
  @IsUUID()
  commentId: string;
}

@ObjectType('RecordComment')
export class RecordCommentDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field()
  body: string;

  @Field(() => [RecordCommentMentionDTO])
  mentions: RecordCommentMentionDTO[];

  @Field(() => UUIDScalarType)
  authorWorkspaceMemberId: string;

  @Field()
  authorName: string;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field()
  canDelete: boolean;
}

@ObjectType('RecordCommentPage')
export class RecordCommentPageDTO {
  @Field(() => [RecordCommentDTO])
  comments: RecordCommentDTO[];

  @Field(() => RecordCommentCursorDTO, { nullable: true })
  nextCursor: RecordCommentCursorDTO | null;
}

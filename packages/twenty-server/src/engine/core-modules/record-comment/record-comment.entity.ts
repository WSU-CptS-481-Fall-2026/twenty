import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';

import { WorkspaceRelatedEntity } from 'src/engine/workspace-manager/types/workspace-related-entity';
import { type RecordCommentMention } from 'src/engine/core-modules/record-comment/record-comment-mention.type';

@Entity({ name: 'recordComment', schema: 'core' })
@Unique('UQ_RECORD_COMMENT_WORKSPACE_ID', ['workspaceId', 'id'])
@Index('IDX_RECORD_COMMENT_STREAM', ['workspaceId', 'createdAt', 'id'])
export class RecordCommentEntity extends WorkspaceRelatedEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  mentions: RecordCommentMention[];

  @Column({ type: 'uuid' })
  authorUserId: string;

  @Column({ type: 'uuid' })
  authorWorkspaceMemberId: string;

  @Column({ type: 'text' })
  authorName: string;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt: Date;
}

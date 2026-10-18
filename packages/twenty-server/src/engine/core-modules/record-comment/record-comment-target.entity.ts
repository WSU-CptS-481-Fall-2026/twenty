import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';

import { RecordCommentEntity } from 'src/engine/core-modules/record-comment/record-comment.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { WorkspaceRelatedEntity } from 'src/engine/workspace-manager/types/workspace-related-entity';

@Entity({ name: 'recordCommentTarget', schema: 'core' })
@Index('IDX_RECORD_COMMENT_TARGET_RECORD', [
  'workspaceId',
  'objectMetadataId',
  'recordId',
])
@Index('UQ_RECORD_COMMENT_TARGET_COMMENT', ['commentId'], { unique: true })
export class RecordCommentTargetEntity extends WorkspaceRelatedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  commentId: string;

  @ManyToOne(() => RecordCommentEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'workspaceId', referencedColumnName: 'workspaceId' },
    { name: 'commentId', referencedColumnName: 'id' },
  ])
  comment: Relation<RecordCommentEntity>;

  @Column({ type: 'uuid' })
  objectMetadataId: string;

  @ManyToOne(() => ObjectMetadataEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'objectMetadataId' })
  objectMetadata: Relation<ObjectMetadataEntity>;

  @Column({ type: 'uuid' })
  recordId: string;
}

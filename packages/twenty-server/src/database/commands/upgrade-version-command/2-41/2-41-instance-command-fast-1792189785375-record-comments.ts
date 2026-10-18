import { QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.41.0', 1792189785375)
export class RecordCommentsFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE TABLE "core"."recordComment" ("workspaceId" uuid NOT NULL, "id" uuid NOT NULL, "body" text NOT NULL, "authorUserId" uuid NOT NULL, "authorWorkspaceMemberId" uuid NOT NULL, "authorName" text NOT NULL, "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_RECORD_COMMENT_WORKSPACE_ID" UNIQUE ("workspaceId", "id"), CONSTRAINT "PK_5d141fb2254cc4aa56fc8c54f45" PRIMARY KEY ("id"))');
    await queryRunner.query('CREATE INDEX "IDX_RECORD_COMMENT_STREAM" ON "core"."recordComment" ("workspaceId", "createdAt", "id") ');
    await queryRunner.query('CREATE TABLE "core"."recordCommentTarget" ("workspaceId" uuid NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "commentId" uuid NOT NULL, "objectMetadataId" uuid NOT NULL, "recordId" uuid NOT NULL, CONSTRAINT "PK_37e0ebc993aa268a9f454d6666d" PRIMARY KEY ("id"))');
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_RECORD_COMMENT_TARGET_COMMENT" ON "core"."recordCommentTarget" ("commentId") ');
    await queryRunner.query('CREATE INDEX "IDX_RECORD_COMMENT_TARGET_RECORD" ON "core"."recordCommentTarget" ("workspaceId", "objectMetadataId", "recordId") ');
    await queryRunner.query('ALTER TABLE "core"."recordComment" ADD CONSTRAINT "FK_e51d611fca6d63eaee5c3633626" FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE ON UPDATE NO ACTION');
    await queryRunner.query('ALTER TABLE "core"."recordCommentTarget" ADD CONSTRAINT "FK_d499fdeb4461b39df0c2f67ad3e" FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE ON UPDATE NO ACTION');
    await queryRunner.query('ALTER TABLE "core"."recordCommentTarget" ADD CONSTRAINT "FK_9c9f90b50a3ee21fd9d2ac90afe" FOREIGN KEY ("workspaceId", "commentId") REFERENCES "core"."recordComment"("workspaceId","id") ON DELETE CASCADE ON UPDATE NO ACTION');
    await queryRunner.query('ALTER TABLE "core"."recordCommentTarget" ADD CONSTRAINT "FK_f94d9be971be32138ec3d64e338" FOREIGN KEY ("objectMetadataId") REFERENCES "core"."objectMetadata"("id") ON DELETE CASCADE ON UPDATE NO ACTION');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "core"."recordCommentTarget" DROP CONSTRAINT "FK_f94d9be971be32138ec3d64e338"');
    await queryRunner.query('ALTER TABLE "core"."recordCommentTarget" DROP CONSTRAINT "FK_9c9f90b50a3ee21fd9d2ac90afe"');
    await queryRunner.query('ALTER TABLE "core"."recordCommentTarget" DROP CONSTRAINT "FK_d499fdeb4461b39df0c2f67ad3e"');
    await queryRunner.query('ALTER TABLE "core"."recordComment" DROP CONSTRAINT "FK_e51d611fca6d63eaee5c3633626"');
    await queryRunner.query('DROP INDEX "core"."IDX_RECORD_COMMENT_TARGET_RECORD"');
    await queryRunner.query('DROP INDEX "core"."UQ_RECORD_COMMENT_TARGET_COMMENT"');
    await queryRunner.query('DROP TABLE "core"."recordCommentTarget"');
    await queryRunner.query('DROP INDEX "core"."IDX_RECORD_COMMENT_STREAM"');
    await queryRunner.query('DROP TABLE "core"."recordComment"');
  }
}

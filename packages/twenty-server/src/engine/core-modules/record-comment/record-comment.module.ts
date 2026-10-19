import { Module } from '@nestjs/common';

import { TypeORMModule } from 'src/database/typeorm/typeorm.module';
import { RecordCommentResolver } from 'src/engine/core-modules/record-comment/record-comment.resolver';
import { RecordCommentService } from 'src/engine/core-modules/record-comment/record-comment.service';

@Module({
  imports: [TypeORMModule],
  providers: [RecordCommentResolver, RecordCommentService],
})
export class RecordCommentModule {}

import { Module } from "@nestjs/common";
import { HashContentService } from "./hashContentService";
import { RandomContentService } from "./randomContentService";


@Module({
  providers: [HashContentService, RandomContentService],
  exports: [HashContentService, RandomContentService],
})
export class UtilsModule {}
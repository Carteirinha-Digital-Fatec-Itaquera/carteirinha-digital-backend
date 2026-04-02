import { Module } from "@nestjs/common";
import { HashContentService } from "./hashContentService";
import { RandomContentService } from "./randomContentService";
import { FirstLoginService } from "./firstLoginService";


@Module({
  providers: [HashContentService, RandomContentService, FirstLoginService],
  exports: [HashContentService, RandomContentService,FirstLoginService],
})
export class UtilsModule {}
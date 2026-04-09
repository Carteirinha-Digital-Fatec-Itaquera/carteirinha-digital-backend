import { Module } from "@nestjs/common";
import { HashContentService } from "./hashContentService";
import { RandomContentService } from "./randomContentService";
import { MailService } from "./mailService";


@Module({
  providers: [HashContentService, RandomContentService, MailService],
  exports: [HashContentService, RandomContentService, MailService],
})
export class UtilsModule {}
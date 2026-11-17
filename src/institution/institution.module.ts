import { Module } from '@nestjs/common';
import { InstitutionController } from './institution.controller';

@Module({
  controllers: [InstitutionController],
})
export class InstitutionModule {}

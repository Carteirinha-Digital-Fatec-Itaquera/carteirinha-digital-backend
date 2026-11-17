import { Controller, Get } from '@nestjs/common';
import { getPublicInstitutionInfo } from './institution.config';

@Controller('public/institution')
export class InstitutionController {
  @Get()
  getInstitutionInfo() {
    return getPublicInstitutionInfo();
  }
}

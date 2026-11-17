import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import {
  RemoveEmployeePhotoDto,
  UploadEmployeePhotoDto,
} from './dto/employee-photo.dto';
import { EmployeePhotoService } from './employee-photo.service';
import { EmployeeService } from './employee.service';
import type { EmployeeEntity } from './entities/employee.entity';
import { EmployeeAccountGuard } from './guards/employee-account.guard';

const STRICT_PIPE = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

interface EmployeeRequest {
  employee: EmployeeEntity;
}

@Controller('funcionarios/me')
@UseGuards(AuthGuard, EmployeeAccountGuard)
@UsePipes(STRICT_PIPE)
export class EmployeeSelfController {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly photoService: EmployeePhotoService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  getMe(@Req() req: EmployeeRequest) {
    return this.employeeService.getMe(req.employee.id);
  }

  @Get('carteirinha')
  @Header('Cache-Control', 'no-store')
  getCredentialCard(@Req() req: EmployeeRequest) {
    return this.employeeService.getMyCredentialCard(req.employee.id);
  }

  @Get('foto')
  @Header('Cache-Control', 'no-store')
  getMyPhoto(@Req() req: EmployeeRequest) {
    return this.photoService.getMyPhotoStatus(req.employee.id);
  }

  @Post('foto')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 256 * 1024 } }),
  )
  uploadMyPhoto(
    @Req() req: EmployeeRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadEmployeePhotoDto,
  ) {
    return this.photoService.uploadPhoto({
      employeeId: req.employee.id,
      file,
      dto,
      actorRole: 'employee',
      actorId: req.employee.id,
    });
  }

  @Delete('foto')
  @Header('Cache-Control', 'no-store')
  removeMyPhoto(
    @Req() req: EmployeeRequest,
    @Body() dto: RemoveEmployeePhotoDto,
  ) {
    return this.photoService.removePhoto(
      req.employee.id,
      dto,
      'employee',
      req.employee.id,
    );
  }

  @Get('fotos/:photoId/conteudo')
  @Header('Cache-Control', 'no-store')
  async getMyPhotoContent(
    @Req() req: EmployeeRequest,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.photoService.getPhotoContent(
      req.employee.id,
      photoId,
    );
    res.setHeader('Content-Type', contentType);
    return res.send(buffer);
  }
}

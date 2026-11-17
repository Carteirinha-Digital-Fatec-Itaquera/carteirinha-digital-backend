import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Secretary } from '@prisma/client';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import {
  RemoveEmployeePhotoDto,
  ReviewEmployeePhotoDto,
  UploadEmployeePhotoDto,
} from './dto/employee-photo.dto';
import { EmployeePhotoService } from './employee-photo.service';

const STRICT_PIPE = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

interface SecretaryRequest {
  secretary: Secretary;
}

@Controller('funcionarios')
@UseGuards(AuthGuard, SecretaryActiveGuard)
@UsePipes(STRICT_PIPE)
export class EmployeePhotoController {
  constructor(private readonly photoService: EmployeePhotoService) {}

  @Get('fotos/pendentes')
  @Header('Cache-Control', 'no-store')
  listPending(
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.photoService.listPendingPhotos(cursor, limit);
  }

  @Get('fotos/resumo')
  @Header('Cache-Control', 'no-store')
  getSummary() {
    return this.photoService.getPendingSummary();
  }

  @Get(':id/fotos/:photoId/conteudo')
  @Header('Cache-Control', 'no-store')
  async getContent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.photoService.getPhotoContent(
      id,
      photoId,
    );
    res.setHeader('Content-Type', contentType);
    return res.send(buffer);
  }

  @Post(':id/foto')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 256 * 1024 } }),
  )
  uploadForEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadEmployeePhotoDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.photoService.uploadPhoto({
      employeeId: id,
      file,
      dto,
      actorRole: 'secretary',
      actorId: String(req.secretary.id),
    });
  }

  @Patch(':id/fotos/:photoId/avaliacao')
  @Header('Cache-Control', 'no-store')
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Body() dto: ReviewEmployeePhotoDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.photoService.reviewPhoto(id, photoId, dto, req.secretary.id);
  }

  @Delete(':id/foto')
  @Header('Cache-Control', 'no-store')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveEmployeePhotoDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.photoService.removePhoto(
      id,
      dto,
      'secretary',
      String(req.secretary.id),
    );
  }
}

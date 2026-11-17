import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
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
import type { EmployeeImportMode, Secretary } from '@prisma/client';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import {
  AnalyzeEmployeeImportDto,
  CancelEmployeeImportDto,
  ConfirmEmployeeImportDto,
  ReprocessEmployeeImportDto,
} from './dto/employee-import.dto';
import { EmployeeImportWorkerService } from './employee-import-worker.service';
import { EmployeeImportService } from './employee-import.service';
import { EMPLOYEE_IMPORT_MAX_FILE_BYTES } from './employee-import.parser';

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
export class EmployeeImportController {
  constructor(
    private readonly importService: EmployeeImportService,
    private readonly importWorker: EmployeeImportWorkerService,
  ) {}

  @Get('modelo-importacao')
  @Header('Cache-Control', 'no-store')
  downloadTemplate(
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    if (format === 'meta') {
      return res.json(this.importService.getTemplateMetadata());
    }
    const fmt = format === 'xlsx' ? 'xlsx' : 'csv';
    const file = this.importService.getTemplateFile(fmt);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return res.send(file.buffer);
  }

  @Post('importacoes/analisar')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: EMPLOYEE_IMPORT_MAX_FILE_BYTES + 1024 },
    }),
  )
  analyze(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: AnalyzeEmployeeImportDto,
    @Req() req: SecretaryRequest,
  ) {
    const mode: EmployeeImportMode = dto.mode ?? 'CREATE_ONLY';
    return this.importService.analyze(file, mode, req.secretary.id);
  }

  @Get('importacoes/:batchId')
  @Header('Cache-Control', 'no-store')
  getBatch(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.importService.getBatch(batchId);
  }

  @Get('importacoes/:batchId/linhas')
  @Header('Cache-Control', 'no-store')
  getBatchRows(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.importService.getBatchRows(batchId, cursor, limit);
  }

  @Post('importacoes/:batchId/confirmar')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  async confirm(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() dto: ConfirmEmployeeImportDto,
    @Req() req: SecretaryRequest,
  ) {
    const result = await this.importService.confirm(
      batchId,
      dto,
      req.secretary.id,
    );
    setImmediate(() => {
      void this.importWorker.processNextBatch(batchId);
    });
    return result;
  }

  @Post('importacoes/:batchId/cancelar')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  cancel(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() dto: CancelEmployeeImportDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.importService.cancel(batchId, dto, req.secretary.id);
  }

  @Post('importacoes/:batchId/reprocessar')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  async reprocess(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() dto: ReprocessEmployeeImportDto,
    @Req() req: SecretaryRequest,
  ) {
    const result = await this.importService.reprocess(
      batchId,
      dto,
      req.secretary.id,
    );
    setImmediate(() => {
      void this.importWorker.processNextBatch(batchId);
    });
    return result;
  }

  @Get('importacoes/:batchId/relatorio')
  @Header('Cache-Control', 'no-store')
  async report(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    const fmt = format === 'xlsx' ? 'xlsx' : 'csv';
    const file = await this.importService.exportReport(batchId, fmt);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return res.send(file.buffer);
  }
}

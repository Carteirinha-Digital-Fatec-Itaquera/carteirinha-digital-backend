import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Secretary } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import {
  CreateAssignmentDto,
  UpdateAssignmentDto,
} from './dto/employee-assignment.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import {
  EmployeeReasonMutationDto,
  RenewEmployeeQrDto,
  UpdateEmployeeStatusDto,
} from './dto/employee-mutation.dto';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeService } from './employee.service';

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
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: EmployeeQueryDto) {
    return this.employeeService.list(query);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@Body() dto: CreateEmployeeDto, @Req() req: SecretaryRequest) {
    return this.employeeService.create(dto, req.secretary.id);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeeService.getById(id);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.employeeService.update(id, dto, req.secretary.id);
  }

  @Post(':id/status')
  @Header('Cache-Control', 'no-store')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeStatusDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.employeeService.updateStatus(id, dto, req.secretary.id);
  }

  @Delete(':id')
  @Header('Cache-Control', 'no-store')
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EmployeeReasonMutationDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.employeeService.archive(id, dto, req.secretary.id);
  }

  @Post(':id/restaurar')
  @Header('Cache-Control', 'no-store')
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EmployeeReasonMutationDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.employeeService.restore(id, dto, req.secretary.id);
  }

  @Get(':id/historico')
  @Header('Cache-Control', 'no-store')
  getHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeeService.getHistory(id);
  }

  @Get(':id/auditoria')
  @Header('Cache-Control', 'no-store')
  getAudits(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.employeeService.getAudits(id, cursor, limit);
  }

  @Post(':id/qrcode/renovar')
  @Header('Cache-Control', 'no-store')
  renewQr(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewEmployeeQrDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.employeeService.renewQr(id, dto, req.secretary.id);
  }

  @Get(':id/funcoes')
  @Header('Cache-Control', 'no-store')
  listAssignments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('includeArchived', new ParseBoolPipe({ optional: true }))
    includeArchived?: boolean,
  ) {
    return this.employeeService.listAssignments(id, includeArchived ?? false);
  }

  @Post(':id/funcoes')
  @Header('Cache-Control', 'no-store')
  createAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAssignmentDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.employeeService.createAssignment(id, dto, req.secretary.id);
  }

  @Patch(':id/funcoes/:assignmentId')
  @Header('Cache-Control', 'no-store')
  updateAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: UpdateAssignmentDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.employeeService.updateAssignment(
      id,
      assignmentId,
      dto,
      req.secretary.id,
    );
  }

  @Delete(':id/funcoes/:assignmentId')
  @Header('Cache-Control', 'no-store')
  archiveAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: EmployeeReasonMutationDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.employeeService.archiveAssignment(
      id,
      assignmentId,
      dto,
      req.secretary.id,
    );
  }

  @Post(':id/funcoes/:assignmentId/restaurar')
  @Header('Cache-Control', 'no-store')
  restoreAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: EmployeeReasonMutationDto,
    @Req() req: SecretaryRequest,
  ) {
    return this.employeeService.restoreAssignment(
      id,
      assignmentId,
      dto,
      req.secretary.id,
    );
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type {
  EmployeePhotoStatusView,
  EmployeePhotoUploadResponse,
  EmployeeProfileView,
  PaginatedListResponse,
  PendingEmployeePhotoItem,
} from '../contracts/v1-employees.types';
import { PrismaService } from '../database/prisma.service';
import { UploadService } from '../upload/upload.service';
import {
  RemoveEmployeePhotoDto,
  ReviewEmployeePhotoDto,
  UploadEmployeePhotoDto,
} from './dto/employee-photo.dto';
import { throwEmployeeError } from './employee.errors';
import { EmployeeService } from './employee.service';
import { latestPhotoAttempt } from './employee-photo-status';
import { EmployeeMapper } from './mapper/employee.mapper';
import { EmployeeRepository } from './repository/employee.repository';

const MAX_PHOTO_BYTES = 200 * 1024;
const ALLOWED_SHARP_FORMATS = new Set(['jpeg', 'png', 'webp']);

@Injectable()
export class EmployeePhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: EmployeeRepository,
    private readonly employeeService: EmployeeService,
    private readonly mapper: EmployeeMapper,
    private readonly uploadService: UploadService,
  ) {}

  async getMyPhotoStatus(employeeId: string): Promise<EmployeePhotoStatusView> {
    const employee = await this.repository.findById(employeeId);
    if (!employee) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Funcionário não encontrado.',
      );
    }

    const photos = await this.prisma.employeePhoto.findMany({
      where: {
        employeeId,
        processingState: 'READY',
        OR: [{ currentApproved: true }, { currentPending: true }],
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const approved = photos.find(
      (p) => p.currentApproved && p.reviewStatus === 'APPROVED',
    );
    const pending = photos.find((p) => p.currentPending);

    return {
      latestAttempt: latestPhotoAttempt(employee.audits),
      approved: approved
        ? {
            id: approved.id,
            reviewStatus: 'APPROVED',
            contentUrl: `/funcionarios/me/fotos/${approved.id}/conteudo`,
            reviewedAt: approved.reviewedAt?.toISOString() ?? null,
          }
        : null,
      pending: pending
        ? {
            id: pending.id,
            reviewStatus: pending.reviewStatus,
            processingState: pending.processingState,
            contentUrl: `/funcionarios/me/fotos/${pending.id}/conteudo`,
            reviewReason: pending.reviewReason ?? null,
            createdAt: pending.createdAt.toISOString(),
          }
        : null,
      version: employee.version,
    };
  }

  async uploadPhoto(params: {
    employeeId: string;
    file: Express.Multer.File | undefined;
    dto: UploadEmployeePhotoDto;
    actorRole: 'employee' | 'secretary';
    actorId: string;
  }): Promise<EmployeePhotoUploadResponse> {
    const { employeeId, file, dto, actorRole, actorId } = params;
    if (!file || !file.buffer || file.buffer.length === 0) {
      throwEmployeeError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Arquivo de foto obrigatório.',
      );
    }

    if (file.buffer.length > MAX_PHOTO_BYTES) {
      throwEmployeeError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'FILE_TOO_LARGE',
        'A foto excede o limite de 200 KB.',
      );
    }

    let meta: sharp.Metadata;
    try {
      meta = await sharp(file.buffer).metadata();
    } catch {
      throwEmployeeError(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'FILE_TYPE_NOT_ALLOWED',
        'Arquivo de imagem inválido ou corrompido.',
      );
    }

    if (
      !meta.format ||
      !ALLOWED_SHARP_FORMATS.has(meta.format) ||
      !meta.width ||
      !meta.height ||
      meta.width < 16 ||
      meta.height < 16 ||
      meta.width > 4096 ||
      meta.height > 4096
    ) {
      throwEmployeeError(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'FILE_TYPE_NOT_ALLOWED',
        'Formato ou dimensões de imagem inválidos. Use JPG, PNG ou WebP.',
      );
    }

    const contentHash = createHash('sha256').update(file.buffer).digest('hex');

    // Check idempotency or reserve slot before uploading
    const existingByReq = await this.prisma.employeePhoto.findUnique({
      where: {
        employeeId_requestId: {
          employeeId,
          requestId: dto.requestId,
        },
      },
    });

    if (existingByReq) {
      if (existingByReq.contentHash !== contentHash) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'REQUEST_ID_REUSED',
          'requestId já utilizado para outra imagem.',
          { requestId: dto.requestId },
        );
      }
      if (existingByReq.processingState === 'READY') {
        const emp = await this.repository.findById(employeeId);
        return {
          photoId: existingByReq.id,
          reviewStatus: 'PENDING',
          processingState: 'READY',
          version: emp?.version ?? existingByReq.version,
        };
      }
    }

    if (existingByReq && existingByReq.processingState !== 'FAILED') {
      throwEmployeeError(
        HttpStatus.CONFLICT,
        'PHOTO_VERSION_CONFLICT',
        'Este envio já está em processamento ou foi encerrado. Atualize a situação antes de tentar novamente.',
      );
    }

    const employeeBefore = await this.repository.findById(employeeId);
    if (!employeeBefore) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Funcionário não encontrado.',
      );
    }
    if (employeeBefore.version !== dto.expectedVersion) {
      throwEmployeeError(
        HttpStatus.CONFLICT,
        'PHOTO_VERSION_CONFLICT',
        'O cadastro foi atualizado por outra operação. Recarregue antes de enviar a foto.',
        { currentVersion: employeeBefore.version },
      );
    }

    const storageKey = `employee-photos/${randomUUID()}`;
    const reserved =
      existingByReq ??
      (await this.prisma.employeePhoto
        .create({
          data: {
            employeeId,
            requestId: dto.requestId,
            storageKey,
            reviewStatus: 'PENDING',
            processingState: 'UPLOADING',
            currentApproved: false,
            currentPending: false,
            contentHash,
          },
        })
        .catch((cause: unknown) => {
          if (
            cause &&
            typeof cause === 'object' &&
            'code' in cause &&
            cause.code === 'P2002'
          ) {
            throwEmployeeError(
              HttpStatus.CONFLICT,
              'PHOTO_VERSION_CONFLICT',
              'Este envio já está em processamento. Atualize a situação.',
            );
          }
          throw cause;
        }));

    if (existingByReq?.processingState === 'FAILED') {
      const claimed = await this.prisma.employeePhoto.updateMany({
        where: { id: reserved.id, processingState: 'FAILED' },
        data: { processingState: 'UPLOADING', nextCleanupAt: null },
      });
      if (claimed.count !== 1)
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'PHOTO_VERSION_CONFLICT',
          'O envio foi retomado por outra operação.',
        );
    }

    try {
      await this.uploadService.uploadPrivateEmployeePhoto(
        file.buffer,
        reserved.storageKey,
      );
    } catch {
      await this.prisma.employeePhoto.update({
        where: { id: reserved.id },
        data: {
          processingState: 'FAILED',
          nextCleanupAt: new Date(),
        },
      });
      throwEmployeeError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'STORAGE_UNAVAILABLE',
        'Serviço de armazenamento temporariamente indisponível.',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.employeeService.lockEmployeeRow(tx, employeeId);
        const current = await this.repository.findById(employeeId, tx);
        if (!current) {
          throwEmployeeError(
            HttpStatus.NOT_FOUND,
            'EMPLOYEE_NOT_FOUND',
            'Funcionário não encontrado.',
          );
        }
        if (current.version !== dto.expectedVersion) {
          throwEmployeeError(
            HttpStatus.CONFLICT,
            'PHOTO_VERSION_CONFLICT',
            'Versão alterada durante o upload. Recarregue e tente novamente.',
            { currentVersion: current.version },
          );
        }

        // Demote any previous pending photo
        await tx.employeePhoto.updateMany({
          where: { employeeId, currentPending: true },
          data: {
            currentPending: false,
            processingState: 'DELETE_PENDING',
            nextCleanupAt: new Date(),
          },
        });

        const updatedEmp = await tx.employee.update({
          where: { id: employeeId },
          data: { version: { increment: 1 } },
        });

        await tx.employeePhoto.update({
          where: { id: reserved.id },
          data: {
            processingState: 'READY',
            currentPending: true,
            version: updatedEmp.version,
          },
        });

        await tx.employeeAudit.create({
          data: {
            employeeId,
            actorRole,
            actorId,
            action: 'PHOTO_UPLOADED',
            requestId: dto.requestId,
            changedFields: { photoId: reserved.id },
          },
        });

        return {
          photoId: reserved.id,
          reviewStatus: 'PENDING',
          processingState: 'READY',
          version: updatedEmp.version,
        };
      });
    } catch (cause) {
      // A cleanup marker written inside the failed transaction would be rolled back.
      await this.prisma.employeePhoto.updateMany({
        where: { id: reserved.id, processingState: 'UPLOADING' },
        data: { processingState: 'DELETE_PENDING', nextCleanupAt: new Date() },
      });
      throw cause;
    }
  }

  async reviewPhoto(
    employeeId: string,
    photoId: string,
    dto: ReviewEmployeePhotoDto,
    secretaryId: number,
  ): Promise<EmployeeProfileView> {
    const reason =
      dto.reason == null
        ? null
        : typeof dto.reason === 'string'
          ? dto.reason.trim() || null
          : undefined;
    if (
      reason === undefined ||
      (reason !== null &&
        (reason.length < 3 ||
          reason.length > 500 ||
          Array.from(reason).some((character) => {
            const code = character.charCodeAt(0);
            return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
          })))
    ) {
      throwEmployeeError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Quando informado, o motivo deve conter de 3 a 500 caracteres válidos.',
        {
          fieldErrors: {
            reason: [
              'Informe de 3 a 500 caracteres, sem caracteres de controle.',
            ],
          },
        },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.employeeService.lockEmployeeRow(tx, employeeId);
      const current = await this.repository.findById(employeeId, tx);
      if (!current) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Funcionário não encontrado.',
        );
      }
      if (current.version !== dto.expectedVersion) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'PHOTO_VERSION_CONFLICT',
          'O cadastro foi atualizado por outra operação.',
          { currentVersion: current.version },
        );
      }

      const photo = await tx.employeePhoto.findFirst({
        where: {
          id: photoId,
          employeeId,
          currentPending: true,
          reviewStatus: 'PENDING',
          processingState: 'READY',
        },
      });
      if (!photo) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'PHOTO_NOT_FOUND',
          'Foto não encontrada para este funcionário.',
        );
      }

      const now = new Date();
      if (dto.approved) {
        await tx.employeePhoto.updateMany({
          where: {
            employeeId,
            currentApproved: true,
            id: { not: photoId },
          },
          data: {
            currentApproved: false,
            processingState: 'DELETE_PENDING',
            nextCleanupAt: now,
          },
        });

        await tx.employeePhoto.update({
          where: { id: photoId },
          data: {
            reviewStatus: 'APPROVED',
            currentApproved: true,
            currentPending: false,
            approvedById: secretaryId,
            reviewReason: reason,
            reviewedAt: now,
          },
        });
      } else {
        await tx.employeePhoto.update({
          where: { id: photoId },
          data: {
            reviewStatus: 'REJECTED',
            currentApproved: false,
            currentPending: false,
            approvedById: secretaryId,
            reviewReason: reason,
            reviewedAt: now,
            processingState: 'DELETE_PENDING',
            nextCleanupAt: now,
          },
        });
      }

      await tx.employee.update({
        where: { id: employeeId },
        data: { version: { increment: 1 } },
      });

      await tx.employeeAudit.create({
        data: {
          employeeId,
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action: dto.approved ? 'PHOTO_APPROVED' : 'PHOTO_REJECTED',
          requestId: `photo-review-${photoId}-${current.version + 1}`,
          reason: reason,
          changedFields: { photoId, approved: dto.approved },
        },
      });

      const reloaded = await this.repository.findById(employeeId, tx);
      return this.mapper.toProfileView(reloaded!, { includeRg: true });
    });
  }

  async removePhoto(
    employeeId: string,
    dto: RemoveEmployeePhotoDto,
    actorRole: 'employee' | 'secretary',
    actorId: string,
  ): Promise<EmployeeProfileView> {
    return this.prisma.$transaction(async (tx) => {
      await this.employeeService.lockEmployeeRow(tx, employeeId);
      const current = await this.repository.findById(employeeId, tx);
      if (!current) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Funcionário não encontrado.',
        );
      }
      if (current.version !== dto.expectedVersion) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'PHOTO_VERSION_CONFLICT',
          'O cadastro foi atualizado por outra operação.',
          { currentVersion: current.version },
        );
      }

      const now = new Date();
      await tx.employeePhoto.updateMany({
        where: {
          employeeId,
          OR: [{ currentApproved: true }, { currentPending: true }],
        },
        data: {
          currentApproved: false,
          currentPending: false,
          processingState: 'DELETE_PENDING',
          nextCleanupAt: now,
        },
      });

      await tx.employee.update({
        where: { id: employeeId },
        data: { version: { increment: 1 } },
      });

      await tx.employeeAudit.create({
        data: {
          employeeId,
          actorRole,
          actorId,
          action: 'PHOTO_REMOVED',
          requestId:
            dto.requestId ??
            `photo-remove-${employeeId}-${current.version + 1}`,
          reason: dto.reason?.trim() ?? 'Remoção de foto',
          changedFields: { removed: true },
        },
      });

      const reloaded = await this.repository.findById(employeeId, tx);
      return this.mapper.toProfileView(reloaded!, { includeRg: true });
    });
  }

  async listPendingPhotos(
    cursor?: string,
    limit = 25,
  ): Promise<PaginatedListResponse<PendingEmployeePhotoItem>> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const items = await this.prisma.employeePhoto.findMany({
      where: {
        reviewStatus: 'PENDING',
        processingState: 'READY',
        currentPending: true,
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            socialName: true,
            registrationNumber: true,
            version: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: safeLimit + 1,
    });

    const hasMore = items.length > safeLimit;
    const page = hasMore ? items.slice(0, safeLimit) : items;

    return {
      items: page.map((p) => ({
        photoId: p.id,
        employeeId: p.employee.id,
        employeeName: p.employee.name,
        displayName: p.employee.socialName?.trim() || p.employee.name,
        registrationNumber: p.employee.registrationNumber ?? null,
        employeeVersion: p.employee.version,
        createdAt: p.createdAt.toISOString(),
        contentUrl: `/funcionarios/${p.employee.id}/fotos/${p.id}/conteudo`,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getPendingSummary(): Promise<{ pendingCount: number }> {
    const pendingCount = await this.prisma.employeePhoto.count({
      where: {
        reviewStatus: 'PENDING',
        processingState: 'READY',
        currentPending: true,
      },
    });
    return { pendingCount };
  }

  async getPhotoContent(
    employeeId: string,
    photoId: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const photo = await this.prisma.employeePhoto.findFirst({
      where: {
        id: photoId,
        employeeId,
        processingState: 'READY',
      },
    });
    if (!photo) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'PHOTO_NOT_FOUND',
        'Foto não encontrada.',
      );
    }

    try {
      return await this.uploadService.getPrivateEmployeePhotoBuffer(
        photo.storageKey,
      );
    } catch {
      throwEmployeeError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'STORAGE_UNAVAILABLE',
        'Armazenamento de fotos temporariamente indisponível.',
      );
    }
  }
}

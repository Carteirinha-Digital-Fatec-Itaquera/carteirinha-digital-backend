import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CheckpointType, EventStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { lockEventForMutation } from './event-mutation-lock';

@Injectable()
export class CheckpointService {
  constructor(private readonly prisma: PrismaService) {}

  async open(eventId: string, type: CheckpointType) {
    return this.prisma.$transaction(async (tx) => {
      const { event, checkpoints } = await lockEventForMutation(tx, eventId);

      if (event.status === EventStatus.CANCELLED) {
        throw new ConflictException(
          'Evento cancelado não permite abertura de checkpoint',
        );
      }

      const checkpoint = checkpoints.find((item) => item.type === type);
      if (!checkpoint) {
        throw new NotFoundException('Checkpoint não encontrado');
      }
      if (checkpoint.isOpen) {
        throw new ConflictException('Checkpoint já está aberto');
      }

      const checkIn = checkpoints.find(
        (item) => item.type === CheckpointType.CHECK_IN,
      );
      const checkOut = checkpoints.find(
        (item) => item.type === CheckpointType.CHECK_OUT,
      );
      if (type === CheckpointType.CHECK_IN) {
        if (event.status === EventStatus.COMPLETED || checkOut?.openedAt) {
          throw new ConflictException(
            'CHECK_IN não pode ser reaberto após o início do CHECK_OUT',
          );
        }
      } else if (
        event.status !== EventStatus.IN_PROGRESS ||
        !checkIn ||
        checkIn.isOpen ||
        !checkIn.openedAt ||
        !checkIn.closedAt
      ) {
        throw new ConflictException(
          'CHECK_OUT exige CHECK_IN encerrado e evento em andamento',
        );
      }

      const now = new Date();
      const result = await tx.eventCheckpoint.updateMany({
        where: {
          id: checkpoint.id,
          isOpen: false,
          version: checkpoint.version,
        },
        data: {
          isOpen: true,
          openedAt: now,
          closedAt: null,
          version: { increment: 1 },
        },
      });

      if (result.count !== 1) {
        throw new ConflictException(
          'Checkpoint foi alterado por outra requisição',
        );
      }

      if (type === CheckpointType.CHECK_IN) {
        await tx.event.update({
          where: { id: eventId },
          data: { status: EventStatus.IN_PROGRESS },
        });
      }

      const updated = await tx.eventCheckpoint.findUnique({
        where: { id: checkpoint.id },
      });
      if (!updated) {
        throw new NotFoundException('Checkpoint não encontrado');
      }
      return this.toMutationResponse(updated);
    });
  }

  async close(eventId: string, type: CheckpointType) {
    return this.prisma.$transaction(async (tx) => {
      const { event, checkpoints } = await lockEventForMutation(tx, eventId);

      if (event.status === EventStatus.CANCELLED) {
        throw new ConflictException(
          'Evento cancelado não permite alteração de checkpoint',
        );
      }

      const checkpoint = checkpoints.find((item) => item.type === type);
      if (!checkpoint) {
        throw new NotFoundException('Checkpoint não encontrado');
      }
      if (!checkpoint.isOpen) {
        throw new ConflictException('Checkpoint já está fechado');
      }

      const result = await tx.eventCheckpoint.updateMany({
        where: {
          id: checkpoint.id,
          isOpen: true,
          version: checkpoint.version,
        },
        data: {
          isOpen: false,
          closedAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (result.count !== 1) {
        throw new ConflictException(
          'Checkpoint foi alterado por outra requisição',
        );
      }
      if (type === CheckpointType.CHECK_OUT) {
        await tx.event.update({
          where: { id: eventId },
          data: { status: EventStatus.COMPLETED },
        });
      }

      const updated = await tx.eventCheckpoint.findUnique({
        where: { id: checkpoint.id },
      });
      if (!updated) {
        throw new NotFoundException('Checkpoint não encontrado');
      }
      return this.toMutationResponse(updated);
    });
  }

  async getOpen(eventId: string, type: CheckpointType) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { checkpoints: true },
    });

    if (!event) {
      throw new NotFoundException('Evento não encontrado');
    }
    if (event.status === EventStatus.CANCELLED) {
      throw new BadRequestException('Evento cancelado');
    }

    const checkpoint = event.checkpoints.find((item) => item.type === type);
    if (!checkpoint) {
      throw new NotFoundException('Checkpoint não encontrado');
    }
    if (!checkpoint.isOpen) {
      throw new BadRequestException(
        'Checkpoint não está aberto para geração de QR Code',
      );
    }

    return checkpoint;
  }

  private toMutationResponse(checkpoint: {
    eventId: string;
    type: CheckpointType;
    isOpen: boolean;
    version: number;
    openedAt: Date | null;
    closedAt: Date | null;
  }) {
    return {
      eventId: checkpoint.eventId,
      type: checkpoint.type,
      isOpen: checkpoint.isOpen,
      version: checkpoint.version,
      openedAt: checkpoint.openedAt?.toISOString() ?? null,
      closedAt: checkpoint.closedAt?.toISOString() ?? null,
    };
  }
}

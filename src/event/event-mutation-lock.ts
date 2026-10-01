import { NotFoundException } from '@nestjs/common';
import { Event, EventCheckpoint, Prisma } from '@prisma/client';

export interface EventMutationState {
  event: Event;
  checkpoints: EventCheckpoint[];
}

export async function lockEventForMutation(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<EventMutationState> {
  // 1. Locks exclusivos nos checkpoints ordenados por type/id
  await tx.$queryRaw`
    SELECT "id" FROM "EventCheckpoint"
    WHERE "eventId" = ${eventId}
    ORDER BY "type" ASC, "id" ASC
    FOR UPDATE
  `;

  // 2. Lock exclusivo no Event
  await tx.$queryRaw`
    SELECT "id" FROM "Event"
    WHERE "id" = ${eventId}
    FOR UPDATE
  `;

  // 3. Devolve estado relido consistente
  const event = await tx.event.findUnique({
    where: { id: eventId },
    include: {
      checkpoints: {
        orderBy: [{ type: 'asc' }, { id: 'asc' }],
      },
    },
  });

  if (!event) {
    throw new NotFoundException('Evento não encontrado');
  }

  const { checkpoints, ...eventWithoutCheckpoints } = event;
  return {
    event: eventWithoutCheckpoints,
    checkpoints,
  };
}

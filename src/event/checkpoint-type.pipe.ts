import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { CheckpointType } from '@prisma/client';

@Injectable()
export class CheckpointTypePipe implements PipeTransform<
  string,
  CheckpointType
> {
  transform(value: string): CheckpointType {
    if (value === 'check-in') return CheckpointType.CHECK_IN;
    if (value === 'check-out') return CheckpointType.CHECK_OUT;

    throw new BadRequestException(
      'Tipo de checkpoint inválido. Use check-in ou check-out',
    );
  }
}

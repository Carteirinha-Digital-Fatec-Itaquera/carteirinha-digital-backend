import { ServiceUnavailableException } from '@nestjs/common';

/** Credits media is deliberately unavailable until its storage can be validated. */
export class ProjectCreditsAssetService {
  unavailable(): never {
    throw new ServiceUnavailableException(
      'Fotos de créditos serão disponibilizadas em uma próxima entrega.',
    );
  }
}

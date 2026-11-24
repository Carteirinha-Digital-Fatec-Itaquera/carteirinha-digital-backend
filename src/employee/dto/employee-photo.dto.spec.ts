import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ReviewEmployeePhotoDto,
  RemoveEmployeePhotoDto,
} from './employee-photo.dto';
describe('Motivo opcional somente na avaliação de fotografia de funcionário', () => {
  it.each([undefined, null, '', '   ', '\n\t'])(
    'normaliza motivo ausente/branco: %j',
    async (reason) => {
      const dto = plainToInstance(ReviewEmployeePhotoDto, {
        expectedVersion: 1,
        approved: false,
        ...(reason === undefined ? {} : { reason }),
      });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.reason ?? null).toBeNull();
    },
  );
  it('preserva texto significativo aparado', async () => {
    const dto = plainToInstance(ReviewEmployeePhotoDto, {
      expectedVersion: 1,
      approved: false,
      reason: '  Rosto fora do enquadramento.  ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.reason).toBe('Rosto fora do enquadramento.');
  });
  it.each(['ab', 'x'.repeat(501), 42, {}, ['texto']])(
    'rejeita conteúdo/tamanho inválido: %j',
    async (reason) => {
      const dto = plainToInstance(ReviewEmployeePhotoDto, {
        expectedVersion: 1,
        approved: false,
        reason,
      });
      expect(
        (await validate(dto)).some((error) => error.property === 'reason'),
      ).toBe(true);
    },
  );
  it('mantém validações de versão, decisão e remoção inalteradas', async () => {
    expect(
      await validate(
        plainToInstance(ReviewEmployeePhotoDto, {
          expectedVersion: 0,
          approved: 'false',
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(RemoveEmployeePhotoDto, {
          expectedVersion: 1,
          reason: '',
        }),
      ),
    ).not.toHaveLength(0);
  });
});

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CancelEventDto } from './cancel-event.dto';
import { UpdateEventDto } from './update-event.dto';

describe('CancelEventDto and UpdateEventDto validation', () => {
  it('rejects empty or whitespace reason', async () => {
    const dto = plainToInstance(CancelEventDto, { reason: '   ' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects reason shorter than 3 chars', async () => {
    const dto = plainToInstance(CancelEventDto, { reason: 'ab' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid reason with 3 chars and performs trim', async () => {
    const dto = plainToInstance(CancelEventDto, { reason: '  abc  ' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.reason).toBe('abc');
  });

  it('accepts reason with exactly 1000 chars', async () => {
    const dto = plainToInstance(CancelEventDto, { reason: 'a'.repeat(1000) });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects reason with 1001 chars', async () => {
    const dto = plainToInstance(CancelEventDto, { reason: 'a'.repeat(1001) });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('validates UpdateEventDto with optional cancelReason', async () => {
    const validDto = plainToInstance(UpdateEventDto, {
      status: 'CANCELLED',
      cancelReason: '  Motivo cancelamento  ',
    });
    const errors = await validate(validDto);
    expect(errors.length).toBe(0);
    expect(validDto.cancelReason).toBe('Motivo cancelamento');
  });

  it('rejects invalid cancelReason on UpdateEventDto', async () => {
    const invalidDto = plainToInstance(UpdateEventDto, {
      status: 'CANCELLED',
      cancelReason: 'ab',
    });
    const errors = await validate(invalidDto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

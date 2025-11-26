import { Test, TestingModule } from '@nestjs/testing';
import { SecretaryService } from './secretary.service';

describe('SecretaryService', () => {
  let service: SecretaryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SecretaryService],
    }).compile();

    service = module.get<SecretaryService>(SecretaryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

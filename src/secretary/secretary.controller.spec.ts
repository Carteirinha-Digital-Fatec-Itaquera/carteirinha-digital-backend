import { Test, TestingModule } from '@nestjs/testing';
import { SecretaryController } from './secretary.controller';

describe('SecretaryController', () => {
  let controller: SecretaryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SecretaryController],
    }).compile();

    controller = module.get<SecretaryController>(SecretaryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

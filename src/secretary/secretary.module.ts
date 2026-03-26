import { Module } from '@nestjs/common';
import { SecretaryService } from './secretary.service';
import { SecretaryController } from './secretary.controller';
import { SecretaryMapper } from './mapper/secretary.mapper';

//Importação |
//           v
// import { DatabaseModule } from 'src/database/database.module';


@Module({
  // Falta do import do DatabaseModule para acessar banco de dados
  // imports: [DatabaseModeule],
  imports: [],
  controllers: [SecretaryController],
  providers: [SecretaryService, SecretaryMapper],
})
export class SecretaryModule {}

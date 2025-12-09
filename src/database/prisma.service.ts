import "dotenv/config";
import { Injectable, Logger, OnModuleInit} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$queryRaw`SELECT 1`;;
      Logger.log('Conexão com o banco de dados estabelecida');
    }
    catch (error){
      Logger.error('Falha na conexão com o Banco de dados, error');
      throw error;
    }
  }
}

//import { PrismaPg } from '@prisma/adapter-pg'
//import { PrismaClient } from '@prisma/client'

//const connectionString = `${process.env.DATABASE_URL}`

//const adapter = new PrismaPg({ connectionString })
//const prisma = new PrismaClient({ adapter })
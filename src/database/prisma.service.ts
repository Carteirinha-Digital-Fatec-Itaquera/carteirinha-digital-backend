import { Injectable } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from 'prisma/generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    const adapter = new PrismaMariaDb(
      'mysql://root:root@localhost:3306/carteirinha-digital-db',
    );
    super({ adapter });
  }
}

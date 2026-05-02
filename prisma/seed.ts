// import { PrismaService } from 'src/database/prisma.service';

import 'dotenv/config' // Carrega as variáveis do .env

import { HashContentService } from 'src/utils/hashContentService';
import { PhotoStatus } from '@prisma/client';

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { error } from 'console';
import { randomUUID } from 'crypto';

//Para rodas as seeds realizar o comando npm run prisma:seed ou se prefirir manualmente npx prisma db seed
const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL,
})
const prisma = new PrismaClient(
{   
    adapter,
    log:[
        {level:'query', emit:'stdout'},
        {level:'error', emit:'stdout'},
        {level:'info', emit:'stdout'},
        {level:'warn', emit:'stdout'}
      ]  
}
)
const hashService = new HashContentService()

async function main() {
    const emailEstudante = process.env.EMAIL_ESTUDANTE_SEED;
    const emailSecretaria = process.env.EMAIL_SECRETARIA_SEED;

    if (!emailEstudante ) {
    console.error("ERRO: Variável EMAIL_ESTUDANTE_SEED não definida no .env");
    return;
    }
    if (!emailSecretaria) {
    console.error("ERRO: Variável EMAIL_SECRETARIA_SEED não definida no .env");
    return;
    }

    const birthDateGeral = new Date('2005-05-03')
    const passwordHash = await hashService.hashContent("123456789")
    const dueDateGeral = new Date("2030-12-12")

    try{

    

    const estudante = await prisma.student.upsert({
        where: { email: emailEstudante },
        update :{email: emailEstudante, password: passwordHash},
        create: {
            ra: "12345678910",
            status: "ATIVO",
            name: "Robson da Silva Prado",
            admission: "2026-01-01",
            email: emailEstudante,
            cpf:'537.815.150-36', 
            qrcode: randomUUID(),
            photo: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTSgr2kXZBnfQTP2FOhOpVQupRTVqKw9m2WIQ&s",
            birthDate: birthDateGeral,
            dueDate: dueDateGeral,
            password: passwordHash,
            course: "DSM",
            photoStatus: PhotoStatus.APPROVED,
            approvedBy: "Coordenador Supremo",
            approvedAt: new Date(),
            // lastLogin: new Date()
        },
    })
    console.log(estudante)


  const secretaria =await prisma.secretary.upsert({
    where: {email: emailSecretaria},
    update:{email: emailSecretaria, password: passwordHash},
    create:{
        name: "Ana Rosa da Silva Pereira de Andrade",
        email: emailSecretaria,
        dueDate:dueDateGeral,
        password:passwordHash,
        birthDate: birthDateGeral,
        // lastLogin: new Date()
    }
  })

  console.log(` Seed finalizado! Estudante configurado: ${estudante.email}`)
  console.log(` Seed finalizado! Secretaria configurado: ${secretaria.email}`)
  }catch(error){
    console.log(error)
  }

  
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1) 
  })
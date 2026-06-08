# Carteirinha Digital - Backend

API REST desenvolvida com NestJS para o sistema de Carteirinha Digital da Fatec Itaquera.

## 🚀 Tecnologias

- Node.js 22+
- NestJS 11
- Prisma 7 (ORM)
- PostgreSQL (Neon)
- JWT para autenticação
- Cloudinary para armazenamento de fotos
- Brevo (API) para envio de e-mails

## 📋 Pré-requisitos

- Node.js 22 ou superior
- npm
- Conta no [Neon](https://neon.tech) (banco de dados PostgreSQL)
- Conta no [Cloudinary](https://cloudinary.com) (armazenamento de fotos)
- Conta de e-mail com SMTP configurado (ex: Gmail)

## ⚙️ Instalação

1. Clone o repositório:
```bash
git clone https://github.com/Carteirinha-Digital-Fatec-Itaquera/carteirinha-digital-backend.git
cd carteirinha-digital-backend
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente — crie um arquivo `.env` na raiz:
```dotenv
DATABASE_URL=
DIRECT_URL=
JWT_SECRET=
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=
MAIL_PASS=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

4. Gere o Prisma Client e sincronize o banco:
```bash
npx prisma generate
npx prisma db push
```

5. Inicie o servidor em modo desenvolvimento:
```bash
npm run start:dev
```

O servidor estará disponível em `http://localhost:3000`.

## 📦 Scripts disponíveis

| Comando | Descrição |
|---|---|
| `npm run start:dev` | Inicia em modo desenvolvimento com hot reload |
| `npm run build` | Gera o build de produção |
| `npm run start:prod` | Inicia o build de produção |
| `npx prisma db push` | Sincroniza o schema com o banco |
| `npx prisma generate` | Gera o Prisma Client |

## 🌐 Deploy

O backend está hospedado no [Render](https://render.com).

- **Build Command:** `npm install --include=dev && npx prisma generate && npx nest build`
- **Start Command:** `node dist/src/main.js`
- **Branch de produção:** `main`

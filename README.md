# Carteirinha Digital - Backend

API REST desenvolvida com NestJS para o sistema de Carteirinha Digital da Fatec Itaquera.

## Contratos de API

O contrato canônico V1 de eventos, presença, checkpoints e certificados está em [docs/contracts/v1-events-spec.md](docs/contracts/v1-events-spec.md). Os tipos de transporte ficam em `src/contracts/v1-events.types.ts` e os exemplos JSON em `docs/contracts/fixtures/`.

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

## Eventos públicos e certificados por atividade

O módulo `public-events` permite inscrições sem conta de aluno, identificação autodeclarada sem código de e-mail, QR estável durante a janela de presença e GPS obrigatório nas atividades abertas a visitantes. A Secretaria configura o evento, modelos por papel e assinantes; exceções presenciais exigem justificativa e autoria. Modelos e assinaturas usados na emissão ficam registrados no snapshot. O layout padrão reutiliza os recursos gráficos do PDF de referência, sem copiar sua assinatura ou dados pessoais.

O QR usa o link curto `/p/:reference`; o servidor resolve o evento e o checkpoint. A validade acompanha o término da janela de presença. Checkpoints legados sem janela explícita usam validade de 15 minutos por QR. A atualização é manual, por `POST /events/:id/checkpoints/:type/qr/refresh`, exclusiva da Secretaria ativa: invalida a versão anterior sem alterar o início ou o término da janela. Fechamento e cancelamento também invalidam a presença. Atividades canceladas ficam fora da seleção pública e da agenda do aluno; o histórico permanece preservado.

As rotas administrativas ficam em `/event-management/*` e exigem Secretaria ativa. `/visitor/*` usa cookie próprio HttpOnly, separado do JWT de aluno. O frontend do aluno encaminha essas rotas por proxy de mesma origem. A verificação pública existente continua compatível com certificados anteriores.

Configuração do backend:

- `DIRECT_URL`: PostgreSQL. Usar migrations versionadas; não substituir por `db push` na liberação.
- `JWT_SECRET` e `ATTENDANCE_QR_SECRET`: manter as configurações existentes.
- `VISITOR_IDENTITY_SECRET`: chave estável dedicada para HMAC dos identificadores temporários; na ausência, usa a chave JWT com finalidade separada. Rotacionar com planejamento de inscrições existentes.
- `STUDENT_APP_URL`: origem HTTPS oficial do Aluno; também usada na validação de origem das mutações de visitante.
- `CERTIFICATE_VERIFICATION_BASE_URL`: origem da página pública de verificação.
- Local padrão: Fatec Itaquera, Av. Miguel Ignácio Curi, 360 - Itaquera, São Paulo - SP, 08295-005; coordenadas fornecidas pela organização: `-23.54503950757055, -46.46790057119243`. O catálogo administrativo fornece esse preset à Secretaria. Raio inicial de 150 m e precisão máxima de 50 m são provisórios para o piloto; configurar `EVENT_VENUE_LATITUDE`, `EVENT_VENUE_LONGITUDE`, `EVENT_VENUE_RADIUS_METERS` e `EVENT_VENUE_MAX_ACCURACY_METERS` permite calibrar sem alterar código. A política é salva por atividade mediante ação da Secretaria; mudar o preset não altera eventos existentes.
- `BREVO_API_KEY` e `EVENT_MAIL_SENDER`: envio de códigos e avisos; o remetente deve estar autorizado no provedor.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: imagens e PDFs autenticados. Validar suporte de PDF e downloads privados na conta antes de habilitar a edição.

O processo contínuo executa os jobs duráveis registrados no PostgreSQL: fechamento de janelas, renderização/entrega com lease e retentativas e expurgo operacional 30 dias após o fim da edição. Falhas finais podem ser reenfileiradas pela Secretaria. Não habilitar visitantes em uma hospedagem que não execute esses jobs. CPF fica desativado por padrão e só é solicitado quando a política da edição o exige; apenas seu HMAC é armazenado.

O expurgo remove contatos, OTP, sessões, desafios e evidência operacional. Nomes, participação, evento, palestrante, snapshots e PDFs emitidos permanecem no arquivo mínimo. Não apaga contas de aluno. A instituição deve definir a política do arquivo e dos backups. Cancelamento revoga todos os certificados, inclusive de visitantes.

Validação local (os scripts de integração recusam bancos remotos e exigem nome `public_events_validation_*`):

```powershell
$env:DIRECT_URL='postgresql://postgres@127.0.0.1:55439/public_events_validation_exemplo'
npx prisma migrate deploy
npm run test:public-events
npm run test:public-events:integration
```

Para testar upgrade, criar outro banco local vazio e executar `npm run test:public-events:migration`. O script aplica as migrations antigas, insere dados fictícios, aplica a nova migration e comprova a preservação do histórico. Não limpa nem reinicia bancos existentes. A integração substitui e-mail e armazenamento exclusivamente dentro do teste; isso não comprova os provedores reais ou precisão física do GPS.

Para o ensaio de navegador, iniciar Aluno em `5187` com `EVENT_API_TARGET=http://127.0.0.1:5309` e Secretaria em `5188` com `VITE_BASE_URL=http://127.0.0.1:5309`. Definir `PUBLIC_EVENTS_BROWSER=1` e, se necessário, `PUBLIC_EVENTS_BROWSER_EXECUTABLE` com o navegador instalado antes de rodar a integração. A API de teste usa somente o banco local e os provedores substitutos; o GPS do ensaio é simulado.

Liberação: backup/restauração verificados, migration aditiva, backend, interfaces compatíveis, assinaturas autorizadas e piloto com aparelhos reais no auditório. Rollback desabilita novas inscrições/atividades públicas e retorna o código; não remove tabelas nem certificados emitidos.

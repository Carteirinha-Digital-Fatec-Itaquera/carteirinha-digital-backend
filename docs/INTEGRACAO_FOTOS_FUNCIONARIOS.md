# Integração de fotografias de funcionários

Entrega em Draft, sujeita à validação visual e funcional. Nenhum merge ou deploy autorizado nesta etapa.

## Ordem de integração

1. Backend issue #102. Campo opcional latestAttempt no contrato de fotos e no perfil, obtido da auditoria existente. Nenhuma migração nova.
2. Secretaria issue #84. Categorias Alunos e Funcionários na tela de fotos existente, resumo separado e soma no menu. Paginação, prévia privada autenticada, ampliação, confirmação por modal, motivo de rejeição e recarga após conflito.
3. Portal issue #6. Apresentação da última rejeição e da substituição pendente, preservando a fotografia aprovada e as melhorias visuais do PR #5.

O campo latestAttempt contém somente photoId, reviewStatus, reviewReason e reviewedAt. Não contém URL pública, storageKey ou bytes. A remoção da fotografia limpa a última tentativa apresentada. A limpeza dos bytes rejeitados não apaga o motivo disponível na auditoria.

A Secretaria utiliza employeeId, photoId e employeeVersion da fila. A avaliação envia expectedVersion, approved e reason. O cliente deriva a rota privada dos identificadores na própria API, sem confiar em contentUrl externo.

A primeira foto pendente bloqueia a credencial por PHOTO_PENDING. Aprovar a imagem permite a emissão apenas quando a conta e o vínculo também são elegíveis. Uma substituta pendente ou rejeitada mantém a imagem aprovada anterior e a credencial válida, conforme as regras existentes. Admissão futura, conta bloqueada/arquivada e ausência de função vigente continuam impedindo a emissão. A matrícula identifica o primeiro acesso e não foi adicionada artificialmente como nova regra de elegibilidade.

## Execução no VS Code

Abra os três repositórios em uma área de trabalho. Use a versão Node indicada pelos projetos e execute npm ci em cada pasta.

Backend local: configure DATABASE_URL e DIRECT_URL para um PostgreSQL descartável, JWT_SECRET e ATTENDANCE_QR_SECRET gerados localmente. Execute npx prisma generate, npx prisma migrate deploy somente nesse banco descartável e npm run start:dev. Não reutilize credenciais de produção.

Secretaria: configure VITE_BASE_URL com a URL da API local e execute npm run dev.
Portal: configure VITE_API_BASE_URL com a mesma API local e execute npm run dev. Primeiro acesso utiliza a matrícula e exige uma senha pessoal. Contas e imagens usadas nas evidências são sintéticas.

Verificações de cada frontend: npm run build e npm run lint. Secretaria: npm test. Portal: npx playwright install chromium e npm run test:browser, que utiliza API simulada.

## Ensaio entre os três sistemas

O script backend/scripts/test-employee-photo-portals.cjs executa o AppModule real com PostgreSQL local e substitui somente o armazenamento privado por um Map em memória e o envio de e-mail por uma função que falha se for utilizada. Não chama Cloudinary nem envia mensagens.

Prepare um banco vazio com as migrações existentes e nome iniciado por disposable_employee_. Defina EMPLOYEE_TEST_DATABASE_URL apontando para 127.0.0.1. Defina SECRETARY_PORTAL_DIR e EMPLOYEE_PORTAL_DIR como caminhos absolutos dos frontends, e PHOTO_TEST_SCREENSHOTS como pasta de evidências. Compile Secretaria com VITE_BASE_URL=http://localhost:3099 e Portal com VITE_API_BASE_URL=http://localhost:3099. Execute NODE_ENV=test node scripts/test-employee-photo-portals.cjs no backend. No PowerShell, atribua NODE_ENV por $env:NODE_ENV='test' antes do comando.

O script abre portas locais 3099, 4277 e 4287. Gera imagens e identidades fictícias, acessa o primeiro login e a criação da senha pela interface, envia a foto pelo Portal, aprova/rejeita pela Secretaria e valida a credencial e o QR efetivamente emitidos pelo backend. Repete em 390×844 e 1440×900 e verifica ausência de rolagem horizontal. Não utiliza QR fictício nesse ensaio. Os testes de regressão do Portal com API simulada são uma camada separada.

Backend HTTP: defina EMPLOYEE_TEST_DATABASE_URL, DATABASE_URL e DIRECT_URL para outro banco descartável e execute npx jest --runInBand --runTestsByPath src/employee/employee.integration.spec.ts src/attendance/employee-attendance.integration.spec.ts --testTimeout=180000. Não execute essas suítes com dados reais, pois elas limpam suas fixtures.

## Limites

A validação local com PostgreSQL e armazenamento simulado não homologa o provedor de armazenamento nem a produção. A aprovação visual e funcional final pertence ao responsável pelo projeto. O PR #101 e a issue #100 permanecem separados.

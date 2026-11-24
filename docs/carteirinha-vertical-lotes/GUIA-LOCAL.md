# Validação local — carteirinha vertical e avaliação de fotos em lote

Entrega em Draft; não integrar nem publicar em produção antes da revisão visual e funcional do responsável. Ordem futura: Backend issue #104 → Secretaria issue #88 → Portal issue #10.

## Preparação no VS Code

Abra cada repositório na branch nova correspondente. Use Node compatível com o package.json/lockfile e execute npm ci. Os testes usam exclusivamente pessoas, tokens e imagens sintéticos.

### Backend

Branch: feature/issue-104-foto-motivo-opcional.

Crie um PostgreSQL local descartável em 127.0.0.1, com banco chamado disposable_employee_fotos. Configure EMPLOYEE_TEST_DATABASE_URL para esse banco e DATABASE_URL/DIRECT_URL com exatamente a mesma URL. Não utilize URLs do Render, Supabase ou produção. Gere JWT_SECRET e ATTENDANCE_QR_SECRET apenas para a sessão de teste. Configure EMPLOYEE_APP_URL=http://localhost:4297.

Execute:

~~~sh
npx prisma generate
npm run build
node scripts/test-employees-integration.cjs src/employee/employee-photo-optional.integration.spec.ts src/employee/employee.integration.spec.ts src/attendance/employee-attendance.integration.spec.ts
npx jest --maxWorkers=3 --testPathIgnorePatterns 'integration|.review-main'
~~~

O runner aplica migrations somente no banco descartável explicitamente informado. O novo teste HTTP também recusa DATABASE_URL/DIRECT_URL divergentes. Não enviar e-mails nem imagens a provedores reais: o teste substitui armazenamento e envio, preservando os serviços reais de domínio, JWT, controllers, auditoria e PostgreSQL.

O contrato PATCH /funcionarios/:id/fotos/:photoId/avaliacao mantém expectedVersion e approved obrigatórios. reason é opcional e anulável. Ausente, null, vazio e somente espaços são normalizados para null. Texto informado é aparado e validado (3–500 caracteres; controles inválidos rejeitados). A remoção de foto e as justificativas de outros fluxos permanecem inalteradas.

### Secretaria

Branch: feature/issue-88-fotos-selecao-lote.

Copie .env.example para .env.local e configure VITE_BASE_URL para o backend LOCAL. Somente depois de utilizar a versão nova do backend, habilite VITE_EMPLOYEE_PHOTO_OPTIONAL_REASON=true. A flag é false por padrão: evita enviar reprovação sem motivo ao backend antigo, exibindo indisponibilidade temporária. Nenhuma configuração de produção foi alterada. Em uma publicação futura, a flag precisa ser habilitada no build da Secretaria após a integração do backend.

~~~sh
npm run build
npm test
npm run test:photos:browser
npm run test:photo-batch
npm run dev
~~~

Para os scripts de navegador, compile com VITE_BASE_URL=http://localhost:3099 e VITE_EMPLOYEE_PHOTO_OPTIONAL_REASON=true; instale o Chromium do Playwright no Portal e informe EMPLOYEE_PORTAL_DIR como caminho absoluto desse repositório. Os scripts iniciam previews locais e simulam a API; não apontam os dados fictícios à produção. PLAYWRIGHT_BROWSERS_PATH é opcional quando houver cache compartilhado.

Valide individualmente e em lote: seleção por employeeId/photoId, selecionar todos carregados, carregar mais, atualização/reconciliação por versão, confirmação/cancelamento, motivo ausente ou preenchido, contadores, resultado integral/parcial, 409 e sessão expirada. Cada foto é avaliada sequencialmente no endpoint existente com sua própria expectedVersion. Não há retry automático. A perda de sessão/permissão interrompe os próximos envios. Em resposta incerta, confira a fila atualizada antes de selecionar novamente.

### Portal de Funcionários

Branch: feature/issue-10-carteirinha-mobile-vertical.

~~~sh
npm run build
npm run lint
npm run test:cache
npm run test:browser
npm run test:ux
npm run test:card-responsive
npm run dev
~~~

Para o teste responsivo, compile com VITE_API_BASE_URL=http://localhost:3099, instale Chromium com npx playwright install chromium e execute npm run test:card-responsive. Os scripts de navegador são validação de UI com API simulada, não homologação de produção.

Abra frente e verso em 320, 375, 390, 430, 768 e 1440 px. No celular há redistribuição real de foto/dados/QR, sem transform de rotação; tablet e desktop mantêm o layout horizontal. Teste nomes e funções longos, rejeição sem motivo e com motivo, foto aprovada anterior e QR bloqueado por inelegibilidade.

## Evidências e limites

Capturas dos novos scripts usam avatar e identidades sintéticas. A foto enviada como referência pelo usuário não foi incorporada ao repositório. A implementação de aluno foi consultada como referência; não foram copiados rotação CSS, código de barras fictício ou persistência offline de fotografias.

Lint global da Secretaria e do backend tem dívida preexistente fora do escopo; o lint dos arquivos novos/alterados foi executado separadamente. O teste legado employee.integration.spec.ts possui alertas históricos de tipagem, sem refatoração ampla nesta entrega. Consulte o relatório para contagens e resultados efetivamente obtidos. A revisão visual e funcional final permanece com o responsável.

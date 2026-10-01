# Relatório de Implementação e Evidências — Issue #39

**Issue:** [#39 — Link direto no QR Code de presença](https://github.com/Carteirinha-Digital-Fatec-Itaquera/carteirinha-digital-backend/issues/39)  
**Branch:** `fix/issue-39-qr-link-integration`  
**Data:** 2026-09-30  
**Ambiente de Teste Local:** PostgreSQL 16 (127.0.0.1:5433, database `issue26_test`)

---

## 1. Mapeamento de Ambientes e Deployments

| Componente | Repositório | Branch | Deployment Público | API / Backend Configurado | Banco / Migrations |
|---|---|---|---|---|---|
| **Backend** | `carteirinha-digital-backend` | `fix/issue-39-qr-link-integration` | `https://carteirinha-digital-backend-d6k1.onrender.com` | N/A | PostgreSQL (10 migrations aplicadas) |
| **Secretaria (Admin)** | `carteirinha-digital-front-end-secretaria` | `fix/issue-39-qr-link-integration` | `https://carteirinha-digital-secretaria.vercel.app` | `VITE_BASE_URL` → Backend Render `d6k1` / `http://localhost:3000` | N/A |
| **Aluno (PWA)** | `carteirinha-digital-front-end-aluno` | `fix/issue-39-qr-link-integration` | `https://carteirinha-digital-front-end-aluno.vercel.app` | `VITE_API_URL` → Backend Render `d6k1` / `http://localhost:3000` | N/A |

---

## 2. Implementação Realizada por Repositório

### 2.1. Backend (`carteirinha-digital-backend`)
- **`src/attendance/attendance-qr-reference.service.ts`**:
  - Implementado `validateConfiguredOrigin(rawUrl?: string): string`: validação estrita da origem configurada (`STUDENT_APP_URL`), rejeição de credenciais (`user:pass`), query strings e fragmentos/hashes. Restringe HTTP exclusivamente a loopback local (`localhost` ou `127.0.0.1`) com porta explícita; exige HTTPS em produção.
  - Implementado `buildQrUrl(reference: string): string`: formatação canônica no padrão `${origin}/p/${reference}` com referência de 22 caracteres base64url.
- **`src/event/qr-token.service.ts`**:
  - Geração de QR Code via HTTP passa a exigir obrigatoriamente `attendanceQrReferenceService` quando `checkpointId` for informado.
  - Retorna `qrUrl` e `serverTime` no contrato `AttendanceQrResponse` sem omitir dependências silenciosamente.
- **`src/contracts/v1-events.types.ts` & `docs/contracts/v1-events-spec.md`**:
  - Documentação canônica dos campos `qrUrl?: string` e `serverTime?: IsoDateTime` no contrato `AttendanceQrResponse`.
  - Documentação da variável `STUDENT_APP_URL` no `.env.example`.

### 2.2. Secretaria (`carteirinha-digital-front-end-secretaria`)
- **`src/utils/attendanceQrLink.ts` & `.test.ts`**:
  - Função pura `validatedAttendanceQrUrl(value: unknown, allowedOrigin: string): string | null` que valida a origem, rejeita credenciais, queries, fragmentos e valida pathname estrito `/p/[A-Za-z0-9_-]{22}`.
  - 11 testes unitários cobrindo URLs válidas, domínios maliciosos, esquemas perigosos e entradas inválidas.
- **`src/screens/events/SecretariaGerenciarEventoScreen.tsx` & `.test.tsx`**:
  - Consome `GLOBAL_VAR.STUDENT_APP_URL` e valida `response.qrUrl`.
  - **Eliminado fallback silencioso** de `qrValue` para `qrToken` (JWT): a câmera nativa exige link direto real.
  - Exibição de mensagem acessível `"Não foi possível gerar o link de presença. Tente atualizar."` com botão de retry caso `qrUrl` seja inválido ou ausente.
  - Elemento SVG marcado com `data-testid="attendance-qr"`, `role="img"` e descrição acessível em projeção padrão e tela cheia.
  - 6 testes com Vitest cobrindo projeção com link, ausência de SVG e retry em caso de erro, e renovação preventiva/limpeza na expiração.
- **`src/api/config/globalVar.ts` & `.env.example`**:
  - Documentado `VITE_STUDENT_APP_URL`.

### 2.3. Aluno (`carteirinha-digital-front-end-aluno`)
- **`src/api/config/apiClient.ts` & `tests/scanner.test.mjs`**:
  - Removido `console.log` de caminhos e referências sensíveis.
  - Teste unitário comprovando que referências de presença não vazam no console.
- **`tests/qr-projection.browser.mjs` & `tests/qr-decode.html`**:
  - Teste end-to-end com Playwright que renderiza o SVG da Secretaria, captura os pixels reais em PNG e decodifica via `html5-qrcode` real sem atalhos.
  - Validação de que os pixels decodificados contêm a URL autorizada real `${STUDENT_APP_URL}/p/<ref>` de 22 caracteres e não um JWT.
  - Prova do fluxo móvel completo: abertura direta sem ativar câmera interna do app, visualização da prévia via GET sem registro de presença, confirmação por toque único via POST, tratamento de duplo toque com idempotência e orientação de re-escaneamento em caso de QR expirado.

---

## 3. Matriz de Evidências de Testes

| Camada / Repositório | Comando Executado | Resultado | Cobertura Validada |
|---|---|---|---|
| **Backend — Unitários** | `npx jest --runInBand src/attendance/attendance-qr-reference.service.spec.ts src/event/qr-token.service.spec.ts src/event/event.controller.spec.ts` | **PASS (27/27)** | Construção de URL segura, rejeição de credenciais/queries, falha explícita na ausência de serviço de referência, serverTime e expiração. |
| **Backend — PostgreSQL Local** | `npm run test:attendance:integration` com `issue26_test` | **PASS (10/10)** | Concorrência, expiração, lock advisory, mesmo QR para múltiplos alunos, prévia GET sem gravação, idempotência no duplo toque, resolução exclusiva no backend de origem. |
| **Secretaria — Unitários** | `npx vitest run src/utils/attendanceQrLink.test.ts src/screens/events/SecretariaGerenciarEventoScreen.test.tsx` | **PASS (17/17)** | Validação de link projetado, renderização de SVG com `data-testid="attendance-qr"`, rejeição de JWT como fallback silencioso, retry em erro de link. |
| **Secretaria — Build** | `npm run build` (`tsc -b && vite build`) | **PASS (0 erros)** | Compilação TypeScript e empacotamento Vite sem quebras. |
| **Aluno — Unitários** | `npm run test:scanner` | **PASS (9/9)** | Parser de presença, compatibilidade com links curtos e JWT legado, segurança contra log de caminhos/tokens no console. |
| **Aluno — Prova de Pixels Browser** | `node tests/qr-projection.browser.mjs` | **PASS (100%)** | Decodificação física de pixels via `html5-qrcode`, URL real, ausência de câmera interna, GET sem escrita, confirmação em um toque, idempotência e expiração. |
| **Aluno — Build & Lint** | `npm run build` && `npx eslint src/api/config/apiClient.ts src/ui/screens/attendance/PresencaConfirmacaoScreen.tsx` | **PASS (0 erros)** | Build PWA gerado com sucesso e zero erros de lint no escopo. |
| **Backend — Lint & Build** | `npx eslint ...` && `npm run build` | **PASS (0 erros)** | Código em conformidade com regras estritas de lint e build NestJS compilado. |

---

## 4. Plano de Rollout e Rollback

### Rollout:
1. Publicar backend com suporte à geração aditiva de `qrUrl` e rota `/attendances/qr/:reference` e `/attendances/scan-reference`.
2. Publicar front-end do Aluno com suporte à rota `/p/:reference` e decodificação mista.
3. Publicar front-end da Secretaria consumindo `VITE_STUDENT_APP_URL` e projetando link direto validado.

### Rollback:
- O contrato preserva compatibilidade com o formato legado `qrToken` (JWT) tanto no scanner do Aluno quanto nas respostas do Backend.
- Se a Secretaria for revertida para uma versão anterior, o aplicativo do Aluno continuará aceitando QR Codes legados.
- Se o backend for revertido para uma versão sem `qrUrl`, a nova tela da Secretaria detectará a ausência do link de presença e exibirá a mensagem amigável de erro com botão de recarregar, sem exibir projeções corrompidas.

---

## 5. Critérios Físicos Pendentes de Validação Humana em Produção

Os critérios abaixo dependem de hardware físico, espaço presencial e telão real de auditório, não podendo ser finalizados exclusivamente em emulador ou testes de software:
- [ ] **Teste de Distância Óptica Real**: Leitura do telão projetado a 15 metros de distância na última fileira do auditório central e lateral.
- [ ] **Amostragem em Dispositivos Físicos Diversificados**: Teste de 30 leituras consecutivas com câmera nativa em Android intermediário/econômico e iOS real.
- [ ] **Tempo de Resposta em Rede Móvel Real**: Medição de abertura do browser nativo, carregamento do PWA e confirmação de presença em conexão 4G/5G local.

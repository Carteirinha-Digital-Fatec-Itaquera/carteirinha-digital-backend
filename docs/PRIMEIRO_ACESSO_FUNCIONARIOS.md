# Primeiro acesso com matrícula funcional

1. A Secretaria cadastra um funcionário com e-mail e matrícula funcional. Cadastros legados sem matrícula precisam ser atualizados na Secretaria.
2. No login, o titular informa o e-mail cadastrado e preenche o campo Senha com a matrícula. O endpoint POST /autenticacao/funcionarios/login retorna firstAccessToken e mustChangePassword=true para contas ativas sem senha.
3. O portal guarda a autorização em memória e abre a tela de criação de senha. POST /autenticacao/funcionarios/ativar recebe token e newPassword. A autorização expira em dez minutos, tem finalidade ACTIVATE e pode ser consumida uma vez. A transação revalida a conta e a versão de autenticação antes de salvar o novo hash.
4. O titular retorna ao login e usa a senha pessoal. Nessa etapa o serviço emite JWT de funcionário. O servidor rejeita a matrícula como senha do dia a dia e mantém a recuperação de senha pessoal por e-mail em forgot-password.
5. Depois da ativação, **Atualizar situação** na Secretaria mostra o acesso ativado.

O login limita tentativas por IP e por e-mail e responde com 401 genérico para credencial inválida. A autorização provisória não autentica chamadas a rotas privadas e não precisa de e-mail. O serviço armazena somente seu hash. Matrículas conhecidas por terceiros ainda permitem tentativas de se antecipar ao titular. Limite o acesso à combinação de matrícula e e-mail até a definição da senha e confira o cadastro de origem.

Use PostgreSQL descartável e contas fictícias ao rodar a suíte de funcionários. Os endpoints antigos solicitar-acesso e convite devolvem 410. A alteração reutiliza o esquema atual de autorizações.

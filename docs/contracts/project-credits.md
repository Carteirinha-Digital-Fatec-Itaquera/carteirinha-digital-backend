# API pública de créditos da Carteirinha Digital

## Endpoint

`GET /project-credits` é público. Os aplicativos do Aluno e da Secretaria consomem o mesmo contrato e não enviam token.

```json
{
  "contributors": [
    {
      "id": "identificador-estavel",
      "name": "Nome aprovado",
      "participations": [
        {
          "semester": "2026.1",
          "roles": ["Desenvolvimento", "Testes"],
          "contribution": "Descrição validada da participação"
        }
      ],
      "contacts": [
        {
          "kind": "github",
          "label": "GitHub",
          "href": "https://github.com/usuario-aprovado"
        }
      ]
    }
  ]
}
```

Os semestres usam `YYYY.1` e `YYYY.2`. Uma pessoa conserva o mesmo `id` nas diferentes participações. O backend omite perfis e participações sem aprovação e publica contatos somente quando a pessoa autorizou o contato específico.

Contatos externos aceitam apenas HTTPS para perfis do GitHub e LinkedIn e para portfólios, sem credenciais, query ou fragment. LinkedIn deve apontar para perfil `/in/`. E-mail precisa ser válido e sem CR/LF. RA, curso, conta acadêmica, autoria de commits, pessoa que aprovou e registros privados não integram a resposta pública.

## Atualização do catálogo

O catálogo em `src/project-credits/project-credits.data.ts` contém o perfil de Wellington Siqueira Porto, os contatos fornecidos por ele e sua participação em 2026.2. Os demais participantes e semestres entram somente após a equipe confirmar a relação histórica e os próprios participantes aprovarem seus contatos. Não preencher nomes, semestres ou contatos a partir de logs, README, listas de atribuições ou suposições.

Atualizações semestrais passam por revisão normal do backend: confirmar nome e contribuição com a equipe do período; confirmar contatos com cada pessoa; incluir apenas o consentimento correspondente no catálogo; revisar diff e implantar a atualização. A fonte versionada registra quem alterou o catálogo e em qual mudança, sem CRUD público.

## Indisponibilidade

A API é independente da autenticação dos alunos e secretários. Cada tela tem estados separados de carregamento, erro com retentativa e catálogo vazio. Erro ao carregar créditos não altera o login, a carteirinha, os eventos ou as demais telas.

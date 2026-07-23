# PulseTray

Aplicativo Electron compacto do Sintonia para a pergunta diária e feedbacks.
Ele permanece na área de notificação, inicia com o sistema e abre a pergunta
no horário escolhido pelo colaborador.

## Desenvolvimento

Requisitos: Node.js 20 ou mais recente.

```sh
npm ci
npm run dev
```

O processo principal lê `PULSETRAY_API_URL` e usa
`https://api.storifly.ai` por padrão. O token informado no onboarding nunca é
entregue ao renderer: ele é armazenado com a proteção nativa do sistema e usado
somente nas chamadas às APIs oficiais.

## Verificação

```sh
npm run typecheck
npm test -- --run
npm run test:coverage
npm run build
npm run dist:mac:dir
npm run check:workflows
npm run pack:dry-run
npm run smoke:npm
```

## Contratos consumidos

- `GET /v1/pulse/question/:employeeId`
- `POST /v1/pulse/answer/:employeeId`
- `POST /v1/pulse/feedbacks`
- consultas autorizadas de colaboradores, índices e dimensões

O serviço atual ainda não oferece uma rota autorizada para resgatar um token
opaco de onboarding nem para listar feedbacks recebidos. Por isso, a vinculação
aceita um token de identidade que contenha e-mail ou Employee ID, e a tela de
recebidos apresenta uma indisponibilidade explícita. Nenhuma rota alternativa,
acesso a banco, datalake ou Manager Hub é utilizado.

## Distribuição

Tags `vX.Y.Z` e execuções manuais disparam a matriz macOS x64/arm64 e Windows
x64, assinatura/notarização quando os segredos estão configurados, checksums,
GitHub Release, publicação npm e instalação real de smoke test.

O pacote global contém apenas o instalador/launcher. Durante o `postinstall`,
ele baixa a versão portátil correspondente, valida o SHA-256 e troca o payload
local de forma atômica:

```sh
npm install -g @code-company/pulsetray
pulsetray --help
pulsetray --version
pulsetray
```

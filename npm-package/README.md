# PulseTray

Este pacote instala a versão portátil do PulseTray a partir da GitHub Release
correspondente. O download é validado com SHA-256 e não executa instaladores
administrativos.

```sh
npm install -g @codecompany/pulsetray
pulsetray
```

Use `pulsetray --help` e `pulsetray --version` sem iniciar a interface.

Variáveis opcionais para mirrors privados: `PULSETRAY_GITHUB_REPO`,
`PULSETRAY_RELEASE_TAG`, `PULSETRAY_RELEASE_BASE_URL` e
`PULSETRAY_GITHUB_TOKEN`.

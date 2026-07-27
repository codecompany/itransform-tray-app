# iTransform Pulse

Este pacote instala a versão portátil do iTransform Pulse a partir da GitHub Release
correspondente. O download é validado com SHA-256 e não executa instaladores
administrativos.

```sh
npm install -g @code-company/pulsetray
pulsetray
```

Use `pulsetray --help` e `pulsetray --version` sem iniciar a interface.

O aplicativo consulta o npm em segundo plano e prepara versões estáveis no
mesmo prefixo global. Ele só reinicia depois que o novo artefato passa pela
validação SHA-256 e não há janela, formulário ou envio em andamento.

Variáveis opcionais para mirrors privados: `PULSETRAY_GITHUB_REPO`,
`PULSETRAY_RELEASE_TAG`, `PULSETRAY_RELEASE_BASE_URL` e
`PULSETRAY_GITHUB_TOKEN`.

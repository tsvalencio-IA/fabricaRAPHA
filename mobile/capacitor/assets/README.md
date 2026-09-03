# Assets do app

Use esta pasta para icone e splash nativos do Capacitor.

Arquivos:

- `icon.png`: 1024x1024 PNG SMARTSAT, pronto para gerar os recursos Android.
- `splash.png`: 2732x2732 PNG para o tema claro.
- `splash-dark.png`: 2732x2732 PNG para o tema escuro.

Depois rode, em um ambiente Node/Android:

```bash
npx @capacitor/assets@latest generate --android
```

O `icon.png` foi derivado da identidade SMARTSAT, sem assinatura textual pequena, para manter legibilidade no launcher. A mesma arte está disponível no PWA em `public/brand/smartsat-icon-1024.png`. Os dois splashes preservam a mesma composição em fundos apropriados para os temas claro e escuro.

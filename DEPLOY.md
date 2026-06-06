# HI-TECH SERGIO — деплой (Git + Netlify)

## Автообновление сайта

После настройки: **push в GitHub** → Netlify сам обновляет сайт за ~1–2 мин.

## Шаг 1 — GitHub (один раз)

В терминале:

```bash
cd "/Volumes/T9/PROJECTS/AUDIO REACT/курсор"
gh auth login -h github.com -p https -w
./scripts/push-github.sh
```

Или вручную: [github.com/new](https://github.com/new) → имя `hi-tech-sergio` → затем:

```bash
git remote add origin https://github.com/ВАШ_ЛОГИН/hi-tech-sergio.git
git push -u origin main
```

## Шаг 2 — Netlify (один раз)

1. [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**.
3. **GitHub** → разреши доступ → выбери репозиторий `hi-tech-sergio`.
4. Настройки сборки (Netlify подхватит `netlify.toml`):
   - **Build command:** пусто или `echo ok`
   - **Publish directory:** `.`
5. **Deploy site**.
6. **Domain management** → **Change site name** → `hi-tech-sergio`  
   → адрес: `https://hi-tech-sergio.netlify.app`

## После правок в Cursor

```bash
cd "/Volumes/T9/PROJECTS/AUDIO REACT/курсор"
git add hi-tech-sergio.html index.html netlify.toml
git commit -m "описание правки"
git push
```

Сайт обновится автоматически.

## Локальная разработка

```bash
npm run dev
```

→ `http://localhost:8080/hi-tech-sergio.html`

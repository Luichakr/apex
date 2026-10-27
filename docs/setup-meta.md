# Настройка Meta (Facebook + Instagram)

Одно приложение Meta покрывает обе сети. Результат этого чек-листа — два значения для `.env`:
`META_APP_ID` и `META_APP_SECRET`.

> Важно: для публикации в Instagram через API аккаунт должен быть **бизнес- или
> creator-аккаунтом** и быть привязан к странице Facebook. Личный профиль Instagram
> через API публиковать нельзя — это ограничение Meta, не наше.

## Что потребуется

- Аккаунт Facebook.
- Страница Facebook (Page), куда будем публиковать.
- Instagram бизнес/creator-аккаунт, привязанный к этой странице (делается в настройках Instagram:
  «Профессиональный аккаунт» → связать со страницей FB).

## Шаги

1. Откройте **https://developers.facebook.com/** и войдите. Примите условия разработчика.
2. **My Apps → Create App.**
3. Тип приложения: выберите **Business**. Введите название (например «APX») и email.
4. В созданном приложении слева откройте **App settings → Basic**. Здесь увидите:
   - **App ID** → это `META_APP_ID`.
   - **App Secret** (нажмите «Show») → это `META_APP_SECRET`.
   Впишите оба в `.env`.
5. В поле **App Domains** добавьте ваш домен (например `apex.ваш-домен.ru`).
   В **Privacy Policy URL** укажите `https://ваш-домен/privacy`, в **Terms** — `/terms`.
6. Добавьте продукты (кнопка **Add Product** на главной приложения):
   - **Facebook Login for Business** — для входа и получения доступа.
   - **Instagram Graph API** (или «Instagram» в новых версиях панели).
7. В **Facebook Login → Settings** → поле **Valid OAuth Redirect URIs** добавьте:
   ```
   https://ваш-домен/api/connect/meta/callback
   ```
   (для локального теста также можно добавить `http://localhost:3000/api/connect/meta/callback`).
8. **Разрешения (permissions).** Нам нужны:
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` — публикация на страницу FB.
   - `instagram_basic`, `instagram_content_publish` — публикация в Instagram.
   - `business_management` — доступ к бизнес-активам.
   В режиме разработки эти разрешения доступны людям с ролью в приложении.

## Как дать доступ друзьям (без долгого ревью)

Пока приложение в режиме **Development**:

1. Перейдите в **App Roles → Roles** (или **Roles → Test Users / People**).
2. Добавьте каждого друга по его аккаунту Facebook как **Tester**.
3. Друг заходит на `developers.facebook.com`, принимает приглашение в роль тестера.
4. После этого он сможет войти в APX и подключить свои FB/IG — публикация заработает.

## Что нужно для доступа ПОСТОРОННИМ (не друзьям)

- Перевести приложение в режим **Live**.
- Пройти **Business Verification** (верификация бизнеса Meta).
- Пройти **App Review**: записать видео, где показан полный цикл публикации, и дождаться одобрения.

Это не требуется для вас и друзей. Делается позже, если захотите открыть сервис шире.

## Итог

В `.env` должно быть заполнено:
```
META_APP_ID=...
META_APP_SECRET=...
```
И в настройках Meta добавлен redirect `https://ваш-домен/api/connect/meta/callback`.

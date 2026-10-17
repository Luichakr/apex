# Настройка Google / YouTube

Результат — два значения для `.env`: `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET`.

## Шаги

1. Откройте **https://console.cloud.google.com/** и войдите аккаунтом Google.
2. Вверху создайте новый проект (**Select a project → New Project**), назовите «APEX».
3. Включите API: **APIs & Services → Library** → найдите **YouTube Data API v3** → **Enable**.
4. Настройте экран согласия: **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Заполните название приложения, email поддержки, домен, ссылки на Privacy/Terms.
   - **Scopes**: добавьте `https://www.googleapis.com/auth/youtube.upload`
     (и при желании `.../auth/youtube.readonly` для чтения канала).
   - **Test users**: добавьте email себя и друзей — в режиме тестирования только они смогут входить.
5. Создайте учётные данные: **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs** → добавьте:
     ```
     https://ваш-домен/api/connect/youtube/callback
     ```
     (для локального теста также `http://localhost:3000/api/connect/youtube/callback`).
   - После создания скопируйте **Client ID** → `GOOGLE_CLIENT_ID`,
     **Client secret** → `GOOGLE_CLIENT_SECRET`. Впишите в `.env`.

## Важные ограничения (честно)

- **Лимит загрузок.** По умолчанию проект имеет небольшую квоту. Одна загрузка видео
  «стоит» 1600 единиц, а дневной пул — 10 000. То есть примерно **6 загрузок в сутки**
  суммарно по всем пользователям, пока не пройдёте аудит квоты Google.
  Для теста и небольшого круга этого хватает; для роста — подаётся заявка на расширение.
- **Непроверенное приложение.** Пока не пройдена верификация Google, при входе будет
  предупреждение «приложение не проверено», и число пользователей ограничено (до 100
  тест-пользователей). Для вас и друзей — нормально.

## Итог

В `.env`:
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```
И в Google Console добавлен redirect `https://ваш-домен/api/connect/youtube/callback`,
а вы и друзья добавлены в **Test users**.

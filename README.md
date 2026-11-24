# MisterCraft Launcher

Лаунчер Minecraft Java Edition на Electron. Чёрно-жёлтый интерфейс, нативное окно Windows.

## Запуск
1. Установите [Node.js 20+](https://nodejs.org).
2. Дважды щёлкните `start.bat` (при первом запуске поставит зависимости).

## Установщик MisterCraft-Setup.exe
- Локально: `build.bat` → файл `dist\MisterCraft-Setup.exe`.
- Без установки Node: загрузите проект в репозиторий GitHub и запустите Actions → «Build installer». Готовый `.exe` появится в артефактах (или в Releases при теге `v1.0.0`).

## Что умеет
- Список всех официальных версий (релизы, снапшоты, Beta/Alpha), поиск.
- Скачивание клиента, библиотек, ресурсов; запуск игры в отдельном окне.
- Fabric и Forge (автоустановка).
- Java: «Авто» (подбор или загрузка нужной Java с Adoptium) либо свой `java.exe`.
- Выбор ОЗУ, управление установленными версиями, открытие папки, журнал игры.
- Аккаунты: вход через Microsoft и офлайн-профили; токены хранятся зашифрованно (Windows DPAPI).
- Данные: `%APPDATA%\.mistercraft`.

## Вход через Microsoft: нужен Azure Client ID
Microsoft не позволяет входить в Minecraft без зарегистрированного приложения, и свой ID я не могу создать за вас.
1. portal.azure.com → Microsoft Entra ID → App registrations → New registration.
2. Тип аккаунтов: «Personal Microsoft accounts only».
3. Authentication → включите «Allow public client flows».
4. Скопируйте Application (client) ID в окно «Аккаунт» лаунчера.
5. Если вход отвечает ошибкой доступа к Minecraft Services, приложение нужно одобрить у Mojang: https://aka.ms/AppRegInfo

## Тесты
`npm test` — проверка логики ядра (правила библиотек, установка, сборка аргументов запуска) на локальном сервере.
